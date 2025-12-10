Electron support

- `electron/main.js` - Electron main process loads a URL or local file and creates a BrowserWindow
- `electron/preload.js` - Preload to expose a minimal secure API to the renderer

Examples

- Start the dev server in one terminal:
  ```powershell
  npm run dev
  ```
- Start electron in another terminal (loads dev server):
  ```powershell
  npm run electron:start
  ```
- Load a built `dist` file in electron:
  ```powershell
  npm run build
  npm run electron:load
  ```

Tips

- To pass a custom url explicitly to electron, you can run:
  ```powershell
  electron . --url=https://example.com
  ```
