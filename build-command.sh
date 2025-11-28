npx ng build # Build Angular app
npx tsc -p tsconfig.electron.json # Compile Electron main process code
# build the Electron app for multiple platforms
# 1. Build for macOS (x86_64)
npx electron-builder --mac --x64 --dir # Package the app , default is x86_64
npx electron-builder --mac dmg zip  --x64 # Create DMG and ZIP installers for macOS x86_64
# 2. Build for macOS (ARM64)
npx electron-builder --mac --arm64 --dir  # Package the app
npx electron-builder --mac dmg zip --arm64  # Create macOS ARM64 build

# 3. Build for Windows
npx electron-builder --win nsis zip # Create NSIS and ZIP installers for Windows
# 4. Build for Linux
npx electron-builder --linux AppImage deb rpm # Create AppImage, DEB, and RPM installers for Linux
