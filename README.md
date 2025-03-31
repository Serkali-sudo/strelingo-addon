# Strelingo Stremio Addon

This Stremio addon fetches subtitles for movies and series from OpenSubtitles and merges two language tracks into a single subtitle file. This is particularly useful for language learners who want to see subtitles in both their native language and the language they are learning simultaneously.

## Features

*   Fetches subtitles from OpenSubtitles.
*   Automatically detects the best available subtitles for two selected languages.
*   Handles Gzip compressed subtitles.
*   Detects and decodes various character encodings (using `chardet` and `iconv-lite`) to support languages with special characters.
*   Merges the main language and translation language subtitles into a single `.srt` file.
*   Formats the translation line to be *italic* and <font color="yellow">yellow</font> (configurable in `index.js`).
*   Configurable via Stremio addon settings for:
    *   Main Language (Audio Language)
    *   Translation Language (Your Language)
*   Includes basic rate limiting to comply with OpenSubtitles API limits.

## Requirements

*   [Node.js](https://nodejs.org/) (Version 14 or higher recommend)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Serkali-sudo/strelingo-addon
    cd strelingo-addon
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    # yarn install
    ```

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
4.  Click the "Install Addon" button or link displayed on the page (it might be at the bottom).
5.  Your browser might ask for permission to open the link with Stremio. Allow it.
6.  Stremio should open and prompt you to confirm the installation **with your selected configuration**. Click "Install".

The addon is now installed and configured with your chosen languages.

## Technical Details

*   **Backend:** Node.js
*   **Stremio SDK:** `stremio-addon-sdk`
*   **Subtitle Source:** OpenSubtitles API
*   **HTTP Requests:** `axios`
*   **Subtitle Parsing:** `srt-parser-2`
*   **Gzip Decompression:** `pako`
*   **Character Encoding Detection:** `chardet`
*   **Character Encoding Decoding:** `iconv-lite`

## Troubleshooting

*   **Incorrect Characters:** If special characters (like ş, ı, ç, ü) are still displayed incorrectly, check the console logs when running `npm start`. Look for messages related to encoding detection (`chardet raw detection`) and decoding (`Successfully decoded subtitle...`). This might indicate an unsupported or incorrectly detected encoding for a specific file.
*   **No Subtitles Found:** Ensure the movie/series exists on OpenSubtitles and has subtitles available in your selected languages. Network issues or OpenSubtitles API rate limits could also be a factor.
*   **Installation Issues:** If `npm install` fails, check your Node.js and npm/yarn installation and network connection. If the problem persists, check the specific error messages.


