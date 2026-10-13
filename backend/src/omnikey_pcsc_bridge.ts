import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function startPcscBridge() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NFC } = require('nfc-pcsc');
    const nfc = new NFC();

    nfc.on('reader', (reader: any) => {
      console.log(`NFC Reader active: ${reader.reader.name}`);
      reader.on('card', async (card: any) => {
        const uid = String(card?.uid || '').toUpperCase();
        if (!uid) return;
        console.log(`Card tapped: ${uid}`);
        try {
          await fetch(`${API_URL}/api/kitchen/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nfcUid: uid }),
          });
        } catch (err) {
          console.error('Failed to send tap to server:', err);
        }
      });
    });
  } catch {
    console.log('To use PC/SC mode on a kitchen PC, run: npm install nfc-pcsc');
  }
}

startPcscBridge();
