using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

internal static class ShellMenuProgram
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length != 1 || args[0] != "serve") return Fail("usage");
            Native.SetProcessDpiAwarenessContext(Native.PerMonitorV2);
            Console.WriteLine("ready");
            Console.Out.Flush();
            ShellSession session = null;
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (line == "quit")
                {
                    if (session != null) session.Dispose();
                    return 0;
                }
                if (line == "release")
                {
                    if (session != null) session.Dispose();
                    session = null;
                    Console.WriteLine("released");
                    Console.Out.Flush();
                    continue;
                }
                if (line.StartsWith("invoke "))
                {
                    try
                    {
                        if (session == null) throw new InvalidOperationException("Меню уже закрыто");
                        session.Run(int.Parse(line.Substring(7).Trim()));
                        Console.WriteLine("invoked");
                    }
                    catch (Exception error)
                    {
                        Console.WriteLine("error");
                        Console.Error.WriteLine(error.Message);
                    }
                    Console.Out.Flush();
                    if (session != null) session.Dispose();
                    session = null;
                    continue;
                }
                if (line != "list") continue;
                if (session != null) session.Dispose();
                session = null;
                bool extended = false;
                long owner = 0;
                string mode = "folder";
                var paths = new List<string>();
                string header;
                while ((header = Console.ReadLine()) != null && header != ".")
                {
                    if (header.StartsWith("extended ")) extended = header.Substring(9).Trim() == "1";
                    else if (header.StartsWith("owner ")) owner = long.Parse(header.Substring(6).Trim());
                    else if (header.StartsWith("mode ")) mode = header.Substring(5).Trim();
                    else if (header.StartsWith("path ")) paths.Add(header.Substring(5));
                }
                try
                {
                    session = MenuHost.Open(mode, paths.ToArray(), extended, new IntPtr(owner));
                    Console.WriteLine(session.Json());
                }
                catch (Exception error)
                {
                    if (session != null) session.Dispose();
                    session = null;
                    Console.WriteLine("error");
                    Console.Error.WriteLine(error.Message);
                }
                Console.Out.Flush();
            }
            if (session != null) session.Dispose();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}

internal static class MenuHost
{
    public static IContextMenu2 Menu2;
    public static IContextMenu3 Menu3;
    private static readonly Native.WndProc Proc = OnMessage;

    public static ShellSession Open(string mode, string[] paths, bool extended, IntPtr owner)
    {
        var session = new ShellSession();
        session.Owner = owner;
        session.Paths = paths ?? new string[0];
        try
        {
            session.Window = CreateHost();
            uint flags = Native.CMF_EXPLORE | Native.CMF_CANRENAME | Native.CMF_SYNCCASCADEMENU;
            if (extended) flags |= Native.CMF_EXTENDEDVERBS;
            if (mode == "files")
            {
                flags |= Native.CMF_ITEMMENU;
                session.ContextPointer = ItemsMenu(session.Window, paths, out session.Absolute);
            }
            else
            {
                if (paths.Length == 0 || paths[0].Length == 0) throw new InvalidOperationException("Нет каталога");
                session.ContextPointer = FolderMenu(session.Window, paths[0], out session.Absolute);
            }
            session.Context = (IContextMenu)Marshal.GetObjectForIUnknown(session.ContextPointer);
            AttachHandlers(session.ContextPointer);
            session.Menu = Native.CreatePopupMenu();
            int query = session.Context.QueryContextMenu(session.Menu, 0, 1, 0x7FFF, flags);
            if (query < 0) Marshal.ThrowExceptionForHR(query);
            Wake(session.Menu, IntPtr.Zero);
            IntPtr verbBuffer = Marshal.AllocCoTaskMem(1024);
            try
            {
                session.Nodes = Trim(Walk(session.Context, session.Menu, 0, verbBuffer));
            }
            finally
            {
                Marshal.FreeCoTaskMem(verbBuffer);
            }
            return session;
        }
        catch
        {
            session.Dispose();
            throw;
        }
    }

    private static void Wake(IntPtr menu, IntPtr parameter)
    {
        if (Menu3 != null)
        {
            IntPtr result;
            Menu3.HandleMenuMsg2(Native.WM_INITMENUPOPUP, menu, parameter, out result);
        }
        else if (Menu2 != null)
        {
            Menu2.HandleMenuMsg(Native.WM_INITMENUPOPUP, menu, parameter);
        }
    }

    private static List<ShellNode> Walk(IContextMenu context, IntPtr menu, int depth, IntPtr verbBuffer)
    {
        var nodes = new List<ShellNode>();
        if (menu == IntPtr.Zero || depth > 8) return nodes;
        int count = Native.GetMenuItemCount(menu);
        for (int index = 0; index < count; index++)
        {
            var info = new Native.MENUITEMINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(Native.MENUITEMINFO));
            info.fMask = 0x02 | 0x100 | 0x01 | 0x40 | 0x04;
            info.dwTypeData = Marshal.AllocCoTaskMem(2048);
            info.cch = 1024;
            try
            {
                if (!Native.GetMenuItemInfo(menu, (uint)index, true, ref info)) continue;
                bool separator = (info.fType & 0x800) != 0;
                string raw = separator ? "" : Marshal.PtrToStringUni(info.dwTypeData) ?? "";
                string label = "";
                string shortcut = "";
                SplitLabel(raw, out label, out shortcut);
                IntPtr nested = info.hSubMenu != IntPtr.Zero ? info.hSubMenu : Native.GetSubMenu(menu, index);
                if (nested != IntPtr.Zero) Wake(nested, new IntPtr(index));
                var children = nested != IntPtr.Zero ? Walk(context, nested, depth + 1, verbBuffer) : new List<ShellNode>();
                int command = -1;
                if (!separator && info.wID >= 1) command = (int)info.wID - 1;
                if (!separator && label.Length == 0 && command >= 0) label = CommandText(context, (uint)command);
                if (!separator && label.Length == 0 && children.Count == 0) continue;
                var node = new ShellNode();
                node.label = label;
                node.shortcut = shortcut;
                node.separator = separator;
                node.disabled = (info.fState & 0x3) != 0;
                node.marked = (info.fState & 0x8) != 0;
                node.command = children.Count == 0 ? command : -1;
                node.verb = node.command >= 0 ? ReadVerb(context, (uint)node.command, verbBuffer) : "";
                node.children = children;
                nodes.Add(node);
            }
            finally
            {
                if (info.dwTypeData != IntPtr.Zero) Marshal.FreeCoTaskMem(info.dwTypeData);
            }
        }
        return nodes;
    }

    private static void SplitLabel(string raw, out string label, out string shortcut)
    {
        label = "";
        shortcut = "";
        if (raw == null || raw.Length == 0) return;
        int tab = raw.IndexOf('\t');
        string body = tab >= 0 ? raw.Substring(0, tab) : raw;
        if (tab >= 0 && tab + 1 < raw.Length) shortcut = raw.Substring(tab + 1).Trim();
        var builder = new StringBuilder();
        for (int index = 0; index < body.Length; index++)
        {
            if (body[index] != '&')
            {
                builder.Append(body[index]);
                continue;
            }
            if (index + 1 < body.Length && body[index + 1] == '&')
            {
                builder.Append('&');
                index++;
            }
        }
        label = builder.ToString().Trim();
    }

    private static string CommandText(IContextMenu context, uint command)
    {
        IntPtr buffer = Marshal.AllocCoTaskMem(1024);
        try
        {
            string help = ReadCommand(context, command, 5, buffer);
            if (help.Length > 0) return help;
            return ReadCommand(context, command, 4, buffer);
        }
        finally
        {
            Marshal.FreeCoTaskMem(buffer);
        }
    }

    public static string ReadVerb(IContextMenu context, uint command, IntPtr buffer)
    {
        return ReadCommand(context, command, 4, buffer);
    }

    private static string ReadCommand(IContextMenu context, uint command, uint kind, IntPtr buffer)
    {
        for (int index = 0; index < 512; index++) Marshal.WriteInt16(buffer, index * 2, 0);
        int read = context.GetCommandString(new UIntPtr(command), kind, IntPtr.Zero, buffer, 512);
        if (read < 0) return "";
        return (Marshal.PtrToStringUni(buffer) ?? "").Trim();
    }

    private static List<ShellNode> Trim(List<ShellNode> nodes)
    {
        var clean = new List<ShellNode>();
        foreach (var node in nodes)
        {
            node.children = Trim(node.children);
            if (node.separator)
            {
                if (clean.Count == 0 || clean[clean.Count - 1].separator) continue;
                clean.Add(node);
                continue;
            }
            if (node.label.Length == 0 && node.children.Count == 0) continue;
            if (node.command < 0 && node.children.Count == 0) continue;
            clean.Add(node);
        }
        while (clean.Count > 0 && clean[clean.Count - 1].separator) clean.RemoveAt(clean.Count - 1);
        return clean;
    }

    private static IntPtr CreateHost()
    {
        var windowClass = new Native.WNDCLASS();
        windowClass.lpfnWndProc = Proc;
        windowClass.hInstance = Native.GetModuleHandle(null);
        windowClass.lpszClassName = "VortexShellMenuHost";
        Native.RegisterClass(ref windowClass);
        IntPtr hwnd = Native.CreateWindowEx(0, windowClass.lpszClassName, "Vortex", unchecked((int)0x80000000), 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, windowClass.hInstance, IntPtr.Zero);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("Не удалось открыть системное меню");
        return hwnd;
    }

    private static void AttachHandlers(IntPtr unknown)
    {
        IntPtr second;
        if (Marshal.QueryInterface(unknown, ref Native.IidContextMenu2, out second) == 0)
        {
            Menu2 = (IContextMenu2)Marshal.GetObjectForIUnknown(second);
            Marshal.Release(second);
        }
        IntPtr third;
        if (Marshal.QueryInterface(unknown, ref Native.IidContextMenu3, out third) == 0)
        {
            Menu3 = (IContextMenu3)Marshal.GetObjectForIUnknown(third);
            Marshal.Release(third);
        }
    }

    private static IntPtr ItemsMenu(IntPtr hwnd, string[] paths, out IntPtr[] absolute)
    {
        if (paths.Length == 0) throw new InvalidOperationException("Нет выбранных файлов");
        absolute = new IntPtr[paths.Length];
        var children = new IntPtr[paths.Length];
        IntPtr parentPointer = IntPtr.Zero;
        try
        {
            for (int index = 0; index < paths.Length; index++)
            {
                uint eaten;
                int parsed = Native.SHParseDisplayName(paths[index], IntPtr.Zero, out absolute[index], 0, out eaten);
                if (parsed < 0) Marshal.ThrowExceptionForHR(parsed);
                IntPtr parent;
                int bound = Native.SHBindToParent(absolute[index], ref Native.IidShellFolder, out parent, out children[index]);
                if (bound < 0) Marshal.ThrowExceptionForHR(bound);
                if (index == 0) parentPointer = parent;
                else Marshal.Release(parent);
            }
            var folder = (IShellFolder)Marshal.GetObjectForIUnknown(parentPointer);
            IntPtr array = Marshal.AllocCoTaskMem(IntPtr.Size * children.Length);
            try
            {
                for (int index = 0; index < children.Length; index++) Marshal.WriteIntPtr(array, index * IntPtr.Size, children[index]);
                IntPtr menu;
                int created = folder.GetUIObjectOf(hwnd, (uint)children.Length, array, ref Native.IidContextMenu, IntPtr.Zero, out menu);
                if (created < 0) Marshal.ThrowExceptionForHR(created);
                Marshal.ReleaseComObject(folder);
                return menu;
            }
            finally
            {
                Marshal.FreeCoTaskMem(array);
            }
        }
        finally
        {
            if (parentPointer != IntPtr.Zero) Marshal.Release(parentPointer);
        }
    }

    private static IntPtr FolderMenu(IntPtr hwnd, string path, out IntPtr[] absolute)
    {
        absolute = new IntPtr[0];
        uint eaten;
        IntPtr parsedPidl;
        int parsed = Native.SHParseDisplayName(path, IntPtr.Zero, out parsedPidl, 0, out eaten);
        if (parsed < 0) Marshal.ThrowExceptionForHR(parsed);
        absolute = new[] { parsedPidl };
        IntPtr desktopPointer;
        int desktopHr = Native.SHGetDesktopFolder(out desktopPointer);
        if (desktopHr < 0) Marshal.ThrowExceptionForHR(desktopHr);
        try
        {
            var desktop = (IShellFolder)Marshal.GetObjectForIUnknown(desktopPointer);
            IntPtr folderPointer;
            int bound = desktop.BindToObject(parsedPidl, IntPtr.Zero, ref Native.IidShellFolder, out folderPointer);
            Marshal.ReleaseComObject(desktop);
            if (bound < 0) Marshal.ThrowExceptionForHR(bound);
            try
            {
                var folder = (IShellFolder)Marshal.GetObjectForIUnknown(folderPointer);
                IntPtr menu;
                int created = folder.CreateViewObject(hwnd, ref Native.IidContextMenu, out menu);
                Marshal.ReleaseComObject(folder);
                if (created < 0) Marshal.ThrowExceptionForHR(created);
                return menu;
            }
            finally
            {
                Marshal.Release(folderPointer);
            }
        }
        finally
        {
            Marshal.Release(desktopPointer);
        }
    }

    private static IntPtr OnMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == Native.WM_TIMER)
        {
            Native.FocusPropertySheet(hwnd);
            return IntPtr.Zero;
        }
        if (message == Native.WM_INITMENUPOPUP || message == Native.WM_DRAWITEM || message == Native.WM_MEASUREITEM || message == Native.WM_MENUCHAR)
        {
            if (Menu3 != null)
            {
                IntPtr result;
                Menu3.HandleMenuMsg2(message, wParam, lParam, out result);
                if (message == Native.WM_MENUCHAR) return result;
            }
            else if (Menu2 != null)
            {
                Menu2.HandleMenuMsg(message, wParam, lParam);
            }
        }
        return Native.DefWindowProc(hwnd, message, wParam, lParam);
    }
}

internal sealed class ShellNode
{
    public string label = "";
    public string shortcut = "";
    public bool separator;
    public bool disabled;
    public bool marked;
    public int command = -1;
    public string verb = "";
    public List<ShellNode> children = new List<ShellNode>();
}

internal sealed class ShellSession : IDisposable
{
    public IntPtr Window;
    public IntPtr Menu;
    public IntPtr ContextPointer;
    public IntPtr Owner;
    public IntPtr[] Absolute = new IntPtr[0];
    public string[] Paths = new string[0];
    public IContextMenu Context;
    public List<ShellNode> Nodes = new List<ShellNode>();
    private bool disposed;

    public string Json()
    {
        var builder = new StringBuilder();
        builder.Append('[');
        for (int index = 0; index < Nodes.Count; index++)
        {
            if (index > 0) builder.Append(',');
            Write(builder, Nodes[index]);
        }
        builder.Append(']');
        return builder.ToString();
    }

    public void Run(int command)
    {
        if (Context == null) throw new InvalidOperationException("Меню уже закрыто");
        string verb = Verb(command);
        Native.PrepareForeground(Owner);
        try
        {
            if (string.Equals(verb, "properties", StringComparison.OrdinalIgnoreCase) && ShowProperties()) return;
            InvokeIndex(command);
        }
        finally
        {
            Native.ReleaseForeground(Owner);
        }
    }

    private string Verb(int command)
    {
        IntPtr buffer = Marshal.AllocCoTaskMem(1024);
        try
        {
            return MenuHost.ReadVerb(Context, (uint)command, buffer);
        }
        finally
        {
            Marshal.FreeCoTaskMem(buffer);
        }
    }

    private bool ShowProperties()
    {
        if (Absolute == null || Absolute.Length != 1 || Absolute[0] == IntPtr.Zero) return false;
        var info = new Native.SHELLEXECUTEINFO();
        info.cbSize = Marshal.SizeOf(typeof(Native.SHELLEXECUTEINFO));
        info.fMask = Native.SEE_MASK_INVOKEIDLIST | Native.SEE_MASK_FLAG_NO_UI | Native.SEE_MASK_FLAG_DDEWAIT | Native.SEE_MASK_UNICODE | Native.SEE_MASK_NOZONECHECKS;
        info.hwnd = Owner;
        info.lpVerb = "properties";
        info.lpIDList = Absolute[0];
        info.nShow = Native.SW_SHOWNORMAL;
        Native.FocusOwner = Owner;
        Native.sheetFocused = false;
        Native.SetTimer(Window, Native.FocusTimer, 30, IntPtr.Zero);
        try
        {
            if (!Native.ShellExecuteEx(ref info)) return false;
            Native.WaitForDialogs(Window);
            return true;
        }
        finally
        {
            Native.KillTimer(Window, Native.FocusTimer);
            Native.FocusOwner = IntPtr.Zero;
        }
    }

    private void InvokeIndex(int command)
    {
        var info = new Native.CMINVOKECOMMANDINFO();
        info.cbSize = Marshal.SizeOf(typeof(Native.CMINVOKECOMMANDINFO));
        info.hwnd = Owner;
        info.lpVerb = (IntPtr)command;
        info.nShow = Native.SW_SHOWNORMAL;
        IntPtr pointer = Marshal.AllocHGlobal(info.cbSize);
        try
        {
            Marshal.StructureToPtr(info, pointer, false);
            int invoked = Context.InvokeCommand(pointer);
            if (invoked < 0) Marshal.ThrowExceptionForHR(invoked);
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (MenuHost.Menu2 != null) Marshal.ReleaseComObject(MenuHost.Menu2);
        if (MenuHost.Menu3 != null) Marshal.ReleaseComObject(MenuHost.Menu3);
        MenuHost.Menu2 = null;
        MenuHost.Menu3 = null;
        if (Menu != IntPtr.Zero) Native.DestroyMenu(Menu);
        if (Context != null) Marshal.ReleaseComObject(Context);
        if (ContextPointer != IntPtr.Zero) Marshal.Release(ContextPointer);
        for (int index = 0; index < Absolute.Length; index++)
        {
            if (Absolute[index] != IntPtr.Zero) Native.ILFree(Absolute[index]);
        }
        if (Window != IntPtr.Zero) Native.DestroyWindow(Window);
    }

    private static void Write(StringBuilder builder, ShellNode node)
    {
        builder.Append("{\"label\":").Append(Json(node.label));
        builder.Append(",\"shortcut\":").Append(Json(node.shortcut));
        builder.Append(",\"separator\":").Append(node.separator ? "true" : "false");
        builder.Append(",\"disabled\":").Append(node.disabled ? "true" : "false");
        builder.Append(",\"checked\":").Append(node.marked ? "true" : "false");
        builder.Append(",\"verb\":").Append(Json(node.verb));
        builder.Append(",\"command\":");
        if (node.command < 0) builder.Append("null");
        else builder.Append(node.command);
        builder.Append(",\"children\":[");
        for (int index = 0; index < node.children.Count; index++)
        {
            if (index > 0) builder.Append(',');
            Write(builder, node.children[index]);
        }
        builder.Append("]}");
    }

    private static string Json(string value)
    {
        var builder = new StringBuilder();
        builder.Append('"');
        if (value != null)
        {
            foreach (char symbol in value)
            {
                if (symbol == '\\' || symbol == '"') builder.Append('\\').Append(symbol);
                else if (symbol == '\n') builder.Append("\\n");
                else if (symbol == '\r') builder.Append("\\r");
                else if (symbol < 32) builder.Append("\\u").Append(((int)symbol).ToString("x4"));
                else builder.Append(symbol);
            }
        }
        builder.Append('"');
        return builder.ToString();
    }
}

internal static class Native
{
    public static readonly IntPtr PerMonitorV2 = new IntPtr(-4);
    public static Guid IidShellFolder = new Guid("000214E6-0000-0000-C000-000000000046");
    public static Guid IidContextMenu = new Guid("000214E4-0000-0000-C000-000000000046");
    public static Guid IidContextMenu2 = new Guid("000214F4-0000-0000-C000-000000000046");
    public static Guid IidContextMenu3 = new Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719");

    public const uint CMF_EXPLORE = 0x00000004;
    public const uint CMF_CANRENAME = 0x00000010;
    public const uint CMF_ITEMMENU = 0x00000080;
    public const uint CMF_EXTENDEDVERBS = 0x00000100;
    public const uint CMF_SYNCCASCADEMENU = 0x00001000;
    public const uint TPM_RIGHTBUTTON = 0x0002;
    public const uint TPM_RETURNCMD = 0x0100;
    public const uint WM_DRAWITEM = 0x002B;
    public const uint WM_MEASUREITEM = 0x002C;
    public const uint WM_INITMENUPOPUP = 0x0117;
    public const uint WM_MENUCHAR = 0x0120;
    public const uint WM_TIMER = 0x0113;
    public const uint GW_OWNER = 4;
    public static readonly UIntPtr FocusTimer = new UIntPtr(0x4F43);
    public static IntPtr FocusOwner;
    public const int SW_SHOWNORMAL = 1;
    public const uint SEE_MASK_INVOKEIDLIST = 0x0000000C;
    public const uint SEE_MASK_FLAG_NO_UI = 0x00000400;
    public const uint SEE_MASK_FLAG_DDEWAIT = 0x00000100;
    public const uint SEE_MASK_UNICODE = 0x00004000;
    public const uint SEE_MASK_NOZONECHECKS = 0x00800000;
    public const int ASFW_ANY = -1;
    private static uint attachedThread;

    public static void PrepareForeground(IntPtr owner)
    {
        AllowSetForegroundWindow(ASFW_ANY);
        if (owner == IntPtr.Zero) return;
        uint processId;
        uint ownerThread = GetWindowThreadProcessId(owner, out processId);
        uint current = GetCurrentThreadId();
        if (ownerThread != 0 && ownerThread != current && AttachThreadInput(current, ownerThread, true)) attachedThread = ownerThread;
    }

    public static void ReleaseForeground(IntPtr owner)
    {
        if (attachedThread == 0) return;
        uint current = GetCurrentThreadId();
        AttachThreadInput(current, attachedThread, false);
        attachedThread = 0;
        if (owner == IntPtr.Zero) return;
    }

    public delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASS
    {
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CMINVOKECOMMANDINFO
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        public IntPtr lpVerb;
        public IntPtr lpParameters;
        public IntPtr lpDirectory;
        public int nShow;
        public uint dwHotKey;
        public IntPtr hIcon;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHELLEXECUTEINFO
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpVerb;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpParameters;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpDirectory;
        public int nShow;
        public IntPtr hInstApp;
        public IntPtr lpIDList;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpClass;
        public IntPtr hkeyClass;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr hProcess;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO info);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern ushort RegisterClass(ref WNDCLASS windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetMenuItemCount(IntPtr menu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetMenuItemInfo(IntPtr menu, uint item, bool byPosition, ref MENUITEMINFO info);

    [DllImport("user32.dll")]
    public static extern IntPtr GetSubMenu(IntPtr menu, int position);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MENUITEMINFO
    {
        public uint cbSize;
        public uint fMask;
        public uint fType;
        public uint fState;
        public uint wID;
        public IntPtr hSubMenu;
        public IntPtr hbmpChecked;
        public IntPtr hbmpUnchecked;
        public IntPtr dwItemData;
        public IntPtr dwTypeData;
        public uint cch;
        public IntPtr hbmpItem;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll")]
    public static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    public static extern uint TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hwnd, IntPtr parameters);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentProcessId();

    public delegate bool EnumProc(IntPtr hwnd, IntPtr param);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    public const uint PM_REMOVE = 0x0001;

    [DllImport("user32.dll")]
    public static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint filterMin, uint filterMax, uint remove);

    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG message);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc callback, IntPtr param);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint milliseconds, IntPtr procedure);

    [DllImport("user32.dll")]
    public static extern bool KillTimer(IntPtr hwnd, UIntPtr id);

    public static bool sheetFocused;

    public static void FocusPropertySheet(IntPtr host)
    {
        if (sheetFocused) return;
        IntPtr dialog = FindPropertySheet(host);
        if (dialog == IntPtr.Zero) return;
        AllowSetForegroundWindow(ASFW_ANY);
        SetForegroundWindow(dialog);
        BringWindowToTop(dialog);
        SetFocus(dialog);
        sheetFocused = true;
    }

    private static IntPtr foundSheet;
    private static IntPtr sheetHost;
    private static readonly EnumProc sheetScan = ScanSheet;

    private static bool ScanSheet(IntPtr hwnd, IntPtr param)
    {
        if (hwnd == sheetHost || !IsWindowVisible(hwnd)) return true;
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        IntPtr owner = GetWindow(hwnd, GW_OWNER);
        bool ours = processId == GetCurrentProcessId();
        bool owned = FocusOwner != IntPtr.Zero && owner == FocusOwner;
        if (ours || owned) foundSheet = hwnd;
        return true;
    }

    private static IntPtr FindPropertySheet(IntPtr host)
    {
        foundSheet = IntPtr.Zero;
        sheetHost = host;
        EnumWindows(sheetScan, IntPtr.Zero);
        return foundSheet;
    }

    private static bool dialogVisible;
    private static IntPtr dialogSkip;
    private static readonly EnumProc dialogScan = ScanDialog;

    private static bool ScanDialog(IntPtr hwnd, IntPtr param)
    {
        if (hwnd == dialogSkip || !IsWindowVisible(hwnd)) return true;
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        if (processId == GetCurrentProcessId()) dialogVisible = true;
        return true;
    }

    public static bool DialogVisible(IntPtr skip)
    {
        dialogVisible = false;
        dialogSkip = skip;
        EnumWindows(dialogScan, IntPtr.Zero);
        return dialogVisible;
    }

    public static void WaitForDialogs(IntPtr skip)
    {
        int start = Environment.TickCount;
        int shown = -1;
        while (true)
        {
            MSG message;
            while (PeekMessage(out message, IntPtr.Zero, 0, 0, PM_REMOVE))
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
            bool open = DialogVisible(skip);
            int now = Environment.TickCount;
            if (open && shown < 0) shown = now;
            if (shown >= 0 && !open) return;
            if (shown < 0 && unchecked(now - start) > 200) return;
            System.Threading.Thread.Sleep(15);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr GetModuleHandle(string module);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHParseDisplayName(string name, IntPtr bindContext, out IntPtr pidl, uint attributes, out uint eaten);

    [DllImport("shell32.dll")]
    public static extern int SHBindToParent(IntPtr pidl, ref Guid iid, out IntPtr parent, out IntPtr child);

    [DllImport("shell32.dll")]
    public static extern int SHGetDesktopFolder(out IntPtr desktop);

    [DllImport("shell32.dll")]
    public static extern void ILFree(IntPtr pidl);
}

[ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellFolder
{
    [PreserveSig]
    int ParseDisplayName(IntPtr hwnd, IntPtr bindContext, [MarshalAs(UnmanagedType.LPWStr)] string name, out uint eaten, out IntPtr pidl, ref uint attributes);
    [PreserveSig]
    int EnumObjects(IntPtr hwnd, int flags, out IntPtr enumerator);
    [PreserveSig]
    int BindToObject(IntPtr pidl, IntPtr bindContext, ref Guid iid, out IntPtr folder);
    [PreserveSig]
    int BindToStorage(IntPtr pidl, IntPtr bindContext, ref Guid iid, out IntPtr storage);
    [PreserveSig]
    int CompareIDs(IntPtr param, IntPtr left, IntPtr right);
    [PreserveSig]
    int CreateViewObject(IntPtr hwnd, ref Guid iid, out IntPtr view);
    [PreserveSig]
    int GetAttributesOf(uint count, IntPtr items, ref uint attributes);
    [PreserveSig]
    int GetUIObjectOf(IntPtr hwnd, uint count, IntPtr items, ref Guid iid, IntPtr reserved, out IntPtr item);
    [PreserveSig]
    int GetDisplayNameOf(IntPtr pidl, uint flags, IntPtr name);
    [PreserveSig]
    int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string name, uint flags, out IntPtr renamed);
}

[ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IContextMenu
{
    [PreserveSig]
    int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig]
    int InvokeCommand(IntPtr info);
    [PreserveSig]
    int GetCommandString(UIntPtr command, uint type, IntPtr reserved, IntPtr name, uint length);
}

[ComImport, Guid("000214F4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IContextMenu2
{
    [PreserveSig]
    int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig]
    int InvokeCommand(IntPtr info);
    [PreserveSig]
    int GetCommandString(UIntPtr command, uint type, IntPtr reserved, IntPtr name, uint length);
    [PreserveSig]
    int HandleMenuMsg(uint message, IntPtr wParam, IntPtr lParam);
}

[ComImport, Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IContextMenu3
{
    [PreserveSig]
    int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig]
    int InvokeCommand(IntPtr info);
    [PreserveSig]
    int GetCommandString(UIntPtr command, uint type, IntPtr reserved, IntPtr name, uint length);
    [PreserveSig]
    int HandleMenuMsg(uint message, IntPtr wParam, IntPtr lParam);
    [PreserveSig]
    int HandleMenuMsg2(uint message, IntPtr wParam, IntPtr lParam, out IntPtr result);
}
