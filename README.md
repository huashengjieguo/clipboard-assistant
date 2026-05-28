# Clipboard Assistant

An Electron-based Windows desktop clipboard assistant with support for text, images, recursive paste queues, fixed-position insertion, file import, reusable groups, tray mode, and global shortcuts.

[中文说明](./ZH_README.md)

## Features

- Save text and image clipboard history.
- Configurable history limit from `10` to `1000`.
- Pin history items to fixed paste positions.
- Multi-line copy: each line becomes one paste item.
- Import `TXT`, `CSV`, and Excel files.
- Reusable groups: save a set of text items and apply them as a paste queue.
- Listen for `Ctrl+V` and automatically prepare the next queue item after paste.
- Support tray mode, close-to-tray, and launch at login.
- Support a global shortcut to open the app window.
- Support both installer and Portable builds.

## Usage

### Clipboard

Copied text or images are saved into clipboard history.

Each history item has a `...` menu with:

- `Delete`
- `Pin to fixed position`
- `Cancel fixed position x`

Clicking a history item copies it back to the system clipboard.

### Multi-Line Copy

Click `Multi-line Copy` and enter multiple lines, for example:

```text
URL
Username
Password
```

After submitting, the app creates a recursive paste queue and copies the first item immediately. In another app, press `Ctrl+V` normally. Clipboard Assistant will automatically prepare the next item after each paste.

### File Import

Click `Import` and choose a file:

- `TXT`: read line by line.
- `CSV`: read cell by cell, ignoring empty cells.
- Excel: read only the first sheet, cell by cell, ignoring empty cells.

Import history only displays the absolute file path, not the imported content.

### Fixed Position Rules

A fixed position item is inserted into the paste sequence at its configured position.

Normal copy:

- Only fixed position `2` is applied.
- If `A` is fixed at position `2` and the user copies `B`, the paste order is:

```text
B -> A
```

Multi-line copy / TXT import:

For normal items:

```text
A
B
C
D
```

With fixed positions `2`, `4`, `5`, and `10`, the paste order is:

```text
A -> fixed position 2 -> B -> fixed position 4 -> fixed position 5 -> C -> D
```

Position `10` is not reached, so it is not inserted.

CSV / Excel import:

Each row is treated as an independent multi-line sequence, and fixed-position rules are applied from the beginning of each row.

### Groups

The `Groups` page supports:

- Search
- Create
- Apply
- Edit
- Delete

When creating or editing a group:

- `name` must be unique.
- Each line in the text area becomes one item.
- Deleting a group requires confirmation.

Clicking `Apply` adds the group to the paste queue using the same rules as multi-line copy.

### Settings

The settings page includes:

- Minimize to tray
- Close to tray
- Launch at login
- Auto-advance after paste
- History limit
- Global shortcut to open the tool

The global shortcut is empty by default. Click the shortcut input and press a key combination such as `Ctrl + Alt + K`, then save. The shortcut can then open the app window from anywhere.

## Development

Install dependencies:

```powershell
npm install
```

Start the development app:

```powershell
npm start
```

Run syntax checks:

```powershell
node --check main.js
node --check preload.js
node --check renderer\app.js
```

## Build

Build both installer and Portable:

```powershell
npm run dist
```

Build installer only:

```powershell
npm run dist:installer
```

Build Portable only:

```powershell
npm run dist:portable
```

Output directory:

```text
release/
```

Typical outputs:

```text
剪贴板助手-0.1.0-安装包.exe
剪贴板助手-0.1.0-Portable.exe
```

## Dependencies

- Electron
- electron-builder
- xlsx
- uiohook-napi

End users do not need Node.js or npm when running the packaged installer or Portable executable.

## Notes

- The Windows clipboard does not notify apps when its content has been pasted. This app listens for `Ctrl+V` and prepares the next item after paste.
- Context-menu paste, custom paste buttons, or special paste behaviors may not trigger auto-advance.
- Fixed-position items can be text or images.
- Groups support text only.
