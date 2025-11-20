npx ng build # Build Angular app
npx tsc -p tsconfig.electron.json # Compile Electron main process code
npx electron-builder --mac --dir # Package the app
npx electron-builder --mac dmg zip # Create DMG and ZIP installers for macOS
npx electron-builder --win nsis zip # Create NSIS and ZIP installers for Windows
npx electron-builder --linux AppImage deb rpm # Create AppImage, DEB, and RPM installers for Linux
