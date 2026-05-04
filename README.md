# Just Us — Google Meet style build

## Run locally

1. Extract the zip.
2. Open the folder.
3. Double-click `start-local.bat`, or open cmd in this folder and run:

```cmd
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Important for phone camera/mic

Phone browsers usually block camera/mic on normal `http://192.168...` links. Use the deployed HTTPS link below for phones.

## Deploy online without ngrok

1. Create a GitHub account.
2. Create a new repository named `just-us-app`.
3. Upload all files from this folder, including `server.js`, `package.json`, `public`, and `render.yaml`.
4. Go to Render.com.
5. New → Web Service → connect your GitHub repo.
6. Use:
   - Build command: `npm install`
   - Start command: `node server.js`
7. Deploy.
8. Render gives you an HTTPS link like:

```text
https://just-us-app.onrender.com
```

Send that link to friends. They only need the room password.

## What changed

- Google Meet style bottom controls.
- Icon-first controls that show full labels on hover.
- Cleaner modern dark UI.
- Page can scroll and adapts on small screens.
- Remote audio unlock button.
- Local preview is muted to reduce echo.
- Echo cancellation, noise suppression and auto gain are enabled.
- No ngrok needed after Render deployment.
