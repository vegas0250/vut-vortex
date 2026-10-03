# Vortex

Vortex — основное рабочее окружение семейства VUT (Vegas Universal Tools). Первая версия — файловый менеджер: каталоги, выбор, создание, переименование, копирование, перемещение и удаление.

```text
VUI          внешний вид, компоненты, темы, плотность
  ↓
VUT Vortex   файловая система, навигация, состояние приложения
  ↓
Electron     окно, IPC, интеграция с ОС
```

Vortex не содержит своей UI-системы. Кнопки, таблица, диалоги, меню мест, оболочка и тема берутся из пакета `vui`. Локальный CSS только растягивает окно и список на область `main`.

## Разработка

Рядом должен быть собранный репозиторий `vui` (`pnpm build` в `vui`). Зависимость объявлена как `file:../vui` версии, которая лежит в этом пакете. Это не копия исходников и не submodule.

```bash
pnpm install
pnpm dev
```

pnpm 10 не запускает установочный скрипт Electron. Если после установки нет `node_modules/electron/dist`, один раз выполните `node node_modules/electron/install.js`.

`pnpm dev` собирает main и preload, поднимает Vite для renderer и открывает Electron.

Проверки:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`lint` и `typecheck` — строгий TypeScript (`noUnusedLocals`). Отдельного стилевого линтера нет: он не нужен, пока правило не ловит то, чего не ловит компилятор.

## Production

```bash
pnpm package:win
pnpm package:linux
pnpm package
```

Сборка production минифицирует main, preload и renderer и не кладёт source maps, тесты и `node_modules` в пакет. VUI попадает в renderer только теми модулями, которые импортированы. `scripts/before-build.cjs` возвращает `false`, чтобы electron-builder не скопировал зависимости повторно.

Цели первой версии:

- Windows x64 — zip;
- Linux x64 — tar.gz.

`electron-builder.yml` оставляет место для других целей (`nsis`, `deb`, `AppImage`) без смены кода приложения. Их нет в первой сборке, потому что для них нужны дополнительные системные инструменты.

## Структура

```text
src/main            цикл приложения, IPC, файловый провайдер
src/main/platform   различия Windows и Linux
src/preload         узкий contextBridge
src/renderer        оболочка на VUI и сценарий файлового менеджера
src/shared          типы и чистые функции без Electron
```

Провайдер файлов один: локальный каталог. FTP, SFTP, SSH, терминал и прочие возможности сюда не входят. Новый источник файлов добавляется отдельным провайдером с тем же видом результата `DirectoryPage`, а не веткой внутри таблицы.

## Правила VUI

Нужен новый внешний вид — меняется VUI, публикуется версия, Vortex обновляет зависимость. В Vortex нельзя заводить свои цвета, типографику, плотность, тему или замену `vui-*`.

Большие каталоги рисует `vui-data-grid` с `fill` и `multiple`. Своей виртуализации у Vortex нет.

Подробная граница слоёв — в [ARCHITECTURE.md](ARCHITECTURE.md).
