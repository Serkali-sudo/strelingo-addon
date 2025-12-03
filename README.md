# Strelingo Stremio Addon

This Stremio addon fetches subtitles for movies and series from OpenSubtitles and merges two language tracks into a single subtitle file. This is particularly useful for language learners who want to see subtitles in both their native language and the language they are learning simultaneously.

![Ekran görüntüsü 2025-04-18 142351](https://github.com/user-attachments/assets/d2441e6c-82b7-4115-876d-1af0e419f6df)

## Easy deploy to vercel
You can easily deploy this addon and host it yourself on vercel by clicking button below. The free hobby plan is more than enough for personal uses. You may need to setup vercel blob storage btw.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/Serkali-sudo/strelingo-addon)

## Demo Live Addon Url
You can either add the Stremio addon by copying this and use add addon in stremio:
 ```bash 
 https://strelingo-addon.vercel.app/manifest.json
 ```
or visit the addon page here:  
[https://strelingo-addon.vercel.app](https://strelingo-addon.vercel.app).

## Providers
* OpenSubtitles.
* [Buta no subs Stremio addon](https://github.com/Pigamer37/buta-no-subs-stremio-addon) for better japanese subtitles (Implemented by @Pigamer37).

## Features

*   Fetches subtitles from OpenSubtitles.
*   Automatically detects the best available subtitles for two selected languages.
*   Handles Gzip compressed subtitles.
*   **Robust encoding detection:** Handles UTF-16 LE/BE (with BOM), double-encoded BOMs, legacy encodings (Windows-1251, ISO-8859-x), and repairs double-encoded UTF-8 text (Implemented by @ravisorg).
*   Merges the main language and translation language subtitles into a single `.srt` file.
*   Formats the translation line to be *italic* and <font color="yellow">yellow</font> (yellow color doesnt work due to stremio overriding the color of subtitles).
*   **Auto-detects your browser language** and sets it as the default translation language on first use!
*   Configurable via Stremio addon settings for:
    *   Main Language (Audio Language)
    *   Translation Language (Your Language)

## Requirements

*   [Node.js](https://nodejs.org/) (Version 14 or higher recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
*   You will need either vercel blob key or supabase storage credentials. Because the addon creates a brand new srt everytime and it has to host somewhere. you can put those credentials in .env (You can techinally return the subtitle as base64 but i have found that it only works for stremio 4 version, it didnt worked in stremio 5 or mobile stremio)
*   **Storage Configuration** - You need to choose at least one storage option. Configure your choice via the `.env` file (see [`.env.example`](.env.example) for all options):
    *   **Option 1: Vercel Blob** (cloud) - Create a Vercel Blob in [Vercel Dashboard](https://vercel.com/dashboard/stores), copy the token, and put it in your `.env` as `BLOB_READ_WRITE_TOKEN`
    *   **Option 2: Supabase Storage** (cloud) - Get `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from your [Supabase project settings](https://app.supabase.com) and add them to your `.env`
    *   **Option 3: Local File Storage** (self-hosted) - Set `LOCAL_STORAGE_DIR=./subtitles` in your `.env`. Useful for running on your home network or private server.

## Local Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Serkali-sudo/strelingo-addon
    cd strelingo-addon
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Configure storage** (create `.env` file):
    ```bash
    # Copy the example configuration
    cp .env.example .env

    # Edit .env and configure your preferred storage option
    ```
    See [`.env.example`](.env.example) for all available options and detailed configuration examples.

## Running the Addon Locally

1.  **Start the addon server:**
    ```bash
    npm start
    # or
    # yarn start
    ```
2.  The console will output messages indicating the server is running.

## Installing and Configuring in Stremio

1.  Ensure the addon server is running locally (see "Running the Addon Locally").
2.  Open your web browser and navigate to the addon's local address (usually `http://localhost:7000/` or the address shown in the console when you start the server).
3.  On the addon configuration page that loads:
    *   Select your desired **Main Language** (typically the language the audio is in).
    *   Select your desired **Translation Language** (typically your native language or the one you want for comparison).
    *   **Note:** The Translation Language field is automatically pre-filled with your browser's language if not previously configured!
4.  Click the "Install Addon" button or link displayed on the page (it might be at the bottom).
5.  Your browser might ask for permission to open the link with Stremio. Allow it.
6.  Stremio should open and prompt you to confirm the installation **with your selected configuration**. Click "Install".

The addon is now installed and configured with your chosen languages.

## Testing

Run encoding tests to verify subtitle decoding works correctly across 40+ languages:

```bash
npm test                              # Run all tests
node test/encoding.test.js --output   # Save decoded files to test/output/
node test/download-inputs.js          # Re-download all test inputs
node test/download-inputs.js tt123456 # Download specific movie
```

Tests validate that decoded subtitles contain expected native-language strings (not just English). To add a new test movie, edit `test/movies.js`.

## Technical Details

*   **Backend:** Node.js
*   **Stremio SDK:** `stremio-addon-sdk`
*   **Subtitle Source:** OpenSubtitles API, [Buta no subs Stremio addon](https://github.com/Pigamer37/buta-no-subs-stremio-addon)
*   **HTTP Requests:** `axios`
*   **Subtitle Parsing:** `srt-parser-2`
*   **Gzip Decompression:** `pako`
*   **Character Encoding Detection:** `chardet`
*   **Character Encoding Decoding:** `iconv-lite`
