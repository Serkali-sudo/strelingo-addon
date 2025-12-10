#!/usr/bin/env node
/**
 * Mark a test input file as a known bad/corrupt input.
 *
 * IMPORTANT: This script should ONLY be used once you have confidently confirmed that
 * the input file IS ACTUALLY CORRUPT. Running this will exclude the specified files
 * from the tests when they fail. Do not mark files as bad without thorough investigation 
 * proving the input file itself is corrupt or unfixable (and is not a bug in our encoding 
 * detection).
 *
 * Usage:
 *   node test/mark-bad-input.js <movie-id> <filename> "<reason>"
 *
 * Example:
 *   node test/mark-bad-input.js tt0133093 bg_3_subf2m.raw "File has mixed Arabic/Latin encoding corruption that cannot be decoded"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KNOWN_BAD_FILE = path.join(__dirname, 'known-bad-inputs.json');
const INPUTS_DIR = path.join(__dirname, 'inputs');

function hashFile(filepath) {
    const buffer = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadKnownBad() {
    if (fs.existsSync(KNOWN_BAD_FILE)) {
        return JSON.parse(fs.readFileSync(KNOWN_BAD_FILE, 'utf8'));
    }
    return {
        _warning: "Do not manually edit this file, use mark-bad-input.js instead. These are genuinely corrupt inputs that have been properly investigated, encoding bugs MUST NOT be listed here.",
        hashes: {}
    };
}

function saveKnownBad(data) {
    fs.writeFileSync(KNOWN_BAD_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.log('Usage: node test/mark-bad-input.js <movie-id> <filename> "<reason>"');
        console.log('');
        console.log('IMPORTANT: Only use this with explicit user approval!');
        console.log('This is for genuinely corrupt input files, not encoding detection bugs.');
        process.exit(1);
    }

    const [movieId, filename, reason] = args;
    const filepath = path.join(INPUTS_DIR, movieId, filename);

    if (!fs.existsSync(filepath)) {
        console.error(`File not found: ${filepath}`);
        process.exit(1);
    }

    const hash = hashFile(filepath);
    const originalFile = `${movieId}/${filename}`;

    const data = loadKnownBad();

    // Check if this hash is already marked
    if (data.hashes[hash]) {
        console.log(`This file is already marked as known bad:`);
        console.log(`  Hash: ${hash.slice(0, 16)}...`);
        console.log(`  Original: ${data.hashes[hash].originalFile}`);
        console.log(`  Reason: ${data.hashes[hash].reason}`);
        process.exit(0);
    }

    data.hashes[hash] = {
        reason,
        markedAt: new Date().toISOString(),
        originalFile
    };

    saveKnownBad(data);

    console.log(`Marked as known bad input:`);
    console.log(`  Hash: ${hash.slice(0, 16)}...`);
    console.log(`  File: ${originalFile}`);
    console.log(`  Reason: ${reason}`);
    console.log(`\nSaved to: ${KNOWN_BAD_FILE}`);
}

main();
