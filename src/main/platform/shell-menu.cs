using System;
using System.Runtime.InteropServices;

internal static class ShellMenuProgram
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 6) return Fail("usage");
            Native.SetProcessDpiAwarenessContext(Native.PerMonitorV2);
            int x = int.Parse(args[0]);
            int y = int.Parse(args[1]);
            bool extended = args[2] == "1";
            IntPtr owner = new IntPtr(long.Parse(args[3]));
            string mode = args[4];
            var paths = new string[args.Length - 5];
            Array.Copy(args, 5, paths, 0, paths.Length);
            bool invoked = MenuHost.Show(mode, paths, x, y, extended, owner);
            Console.WriteLine(invoked ? "invoked" : "cancel");
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
    private static IContextMenu2 menu2;
    private static IContextMenu3 menu3;
    private static readonly Native.WndProc Proc = OnMessage;

    public static bool Show(string mode, string[] paths, int x, int y, bool extended, IntPtr owner)
    {
        IntPtr hwnd = IntPtr.Zero;
        IntPtr menu = IntPtr.Zero;
        IntPtr contextPointer = IntPtr.Zero;
        IntPtr[] absolute = new IntPtr[0];
        IContextMenu context = null;
        try
        {
            hwnd = CreateHost();
            uint flags = Native.CMF_EXPLORE | Native.CMF_CANRENAME | Native.CMF_SYNCCASCADEMENU;
            if (extended) flags |= Native.CMF_EXTENDEDVERBS;
            if (mode == "files")
            {
                flags |= Native.CMF_ITEMMENU;
                contextPointer = ItemsMenu(hwnd, paths, out absolute);
            }
            else
            {
                if (paths.Length == 0 || paths[0].Length == 0) throw new InvalidOperationException("Нет каталога");
                contextPointer = FolderMenu(hwnd, paths[0]);
            }
            context = (IContextMenu)Marshal.GetObjectForIUnknown(contextPointer);
            AttachHandlers(contextPointer);
            menu = Native.CreatePopupMenu();
            int query = context.QueryContextMenu(menu, 0, 1, 0x7FFF, flags);
            if (query < 0) Marshal.ThrowExceptionForHR(query);
            uint command = 0;
            FocusAround(owner != IntPtr.Zero ? owner : hwnd, delegate
            {
                command = Native.TrackPopupMenuEx(menu, Native.TPM_RETURNCMD | Native.TPM_RIGHTBUTTON, x, y, hwnd, IntPtr.Zero);
            });
            if (command == 0) return false;
            Invoke(context, owner != IntPtr.Zero ? owner : hwnd, command);
            return true;
        }
        finally
        {
            if (menu2 != null) Marshal.ReleaseComObject(menu2);
            if (menu3 != null) Marshal.ReleaseComObject(menu3);
            menu2 = null;
            menu3 = null;
            if (menu != IntPtr.Zero) Native.DestroyMenu(menu);
            if (context != null) Marshal.ReleaseComObject(context);
            if (contextPointer != IntPtr.Zero) Marshal.Release(contextPointer);
            for (int index = 0; index < absolute.Length; index++)
            {
                if (absolute[index] != IntPtr.Zero) Native.ILFree(absolute[index]);
            }
            if (hwnd != IntPtr.Zero) Native.DestroyWindow(hwnd);
        }
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
            menu2 = (IContextMenu2)Marshal.GetObjectForIUnknown(second);
            Marshal.Release(second);
        }
        IntPtr third;
        if (Marshal.QueryInterface(unknown, ref Native.IidContextMenu3, out third) == 0)
        {
            menu3 = (IContextMenu3)Marshal.GetObjectForIUnknown(third);
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

    private static IntPtr FolderMenu(IntPtr hwnd, string path)
    {
        uint eaten;
        IntPtr absolute;
        int parsed = Native.SHParseDisplayName(path, IntPtr.Zero, out absolute, 0, out eaten);
        if (parsed < 0) Marshal.ThrowExceptionForHR(parsed);
        IntPtr desktopPointer;
        int desktopHr = Native.SHGetDesktopFolder(out desktopPointer);
        if (desktopHr < 0) Marshal.ThrowExceptionForHR(desktopHr);
        try
        {
            var desktop = (IShellFolder)Marshal.GetObjectForIUnknown(desktopPointer);
            IntPtr folderPointer;
            int bound = desktop.BindToObject(absolute, IntPtr.Zero, ref Native.IidShellFolder, out folderPointer);
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
                Native.ILFree(absolute);
            }
        }
        finally
        {
            Marshal.Release(desktopPointer);
        }
    }

    private static void Invoke(IContextMenu context, IntPtr hwnd, uint command)
    {
        var info = new Native.CMINVOKECOMMANDINFO();
        info.cbSize = Marshal.SizeOf(typeof(Native.CMINVOKECOMMANDINFO));
        info.hwnd = hwnd;
        info.lpVerb = (IntPtr)(command - 1);
        info.nShow = Native.SW_SHOWNORMAL;
        IntPtr pointer = Marshal.AllocHGlobal(info.cbSize);
        try
        {
            Marshal.StructureToPtr(info, pointer, false);
            int invoked = context.InvokeCommand(pointer);
            if (invoked < 0) Marshal.ThrowExceptionForHR(invoked);
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static void FocusAround(IntPtr hwnd, Action show)
    {
        uint process;
        IntPtr foreground = Native.GetForegroundWindow();
        uint foreign = Native.GetWindowThreadProcessId(foreground, out process);
        uint current = Native.GetCurrentThreadId();
        bool attached = foreign != 0 && foreign != current && Native.AttachThreadInput(current, foreign, true);
        try
        {
            Native.SetForegroundWindow(hwnd);
            show();
        }
        finally
        {
            if (attached) Native.AttachThreadInput(current, foreign, false);
        }
    }

    private static IntPtr OnMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == Native.WM_INITMENUPOPUP || message == Native.WM_DRAWITEM || message == Native.WM_MEASUREITEM || message == Native.WM_MENUCHAR)
        {
            if (menu3 != null)
            {
                IntPtr result;
                menu3.HandleMenuMsg2(message, wParam, lParam, out result);
                if (message == Native.WM_MENUCHAR) return result;
            }
            else if (menu2 != null)
            {
                menu2.HandleMenuMsg(message, wParam, lParam);
            }
        }
        return Native.DefWindowProc(hwnd, message, wParam, lParam);
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
    public const int SW_SHOWNORMAL = 1;

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
