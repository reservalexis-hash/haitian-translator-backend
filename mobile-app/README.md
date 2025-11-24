# Haitian Translator Mobile App

This is the mobile app version of the English ↔ Spanish ↔ Haitian Creole Translator.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Build the app:
```bash
npm run build
```

3. Add Android platform:
```bash
npx cap add android
```

4. Open in Android Studio:
```bash
npm run android
```

## Running on Your Phone

### Android
1. Connect your Android phone via USB
2. Enable USB debugging on your phone (Developer options)
3. In Android Studio, select your device and click Run
4. The app will be installed on your phone

### Building Release APK
1. In Android Studio:
   - Build > Generate Signed Bundle / APK
   - Choose APK
   - Create or select a keystore
   - Choose release build variant
   - The APK will be in android/app/release/

## Development

- Edit `www/index.html` for UI changes
- The app connects to a cloud-hosted backend for API calls
- Run `npm run build` after any changes
- Run `npm run android` to open in Android Studio

## Notes

- The backend API must be deployed to a cloud service (e.g., Render)
- Update `SERVER_BASE_URL` in index.html to point to your cloud API
- iOS builds require a Mac with Xcode installed