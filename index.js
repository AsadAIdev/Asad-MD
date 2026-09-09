#!/usr/bin/env node

/**
 * Asad-MD Bot
 * Main entry point for the bot application
 */

const axios = require('axios');
const express = require('express');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Initialize logger
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Import WhatsApp Web Client
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// Load plugins
const pluginsPath = path.join(__dirname, 'plugins');
const plugins = [];

if (fs.existsSync(pluginsPath)) {
  fs.readdirSync(pluginsPath).forEach(file => {
    if (file.endsWith('.js')) {
      try {
        const plugin = require(path.join(pluginsPath, file));
        plugins.push(plugin);
        logger.info(`✅ Loaded plugin: ${file}`);
      } catch (err) {
        logger.error(`❌ Error loading plugin ${file}:`, err.message);
      }
    }
  });
}

// Express app for pairing code display
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pairingCode = null;

// Serve pairing website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/pairing', (req, res) => {
  res.json({ pairingCode });
});

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox'],
  }
});

// QR Code event
client.on('qr', async (qr) => {
  logger.info('📱 QR Code generated, scan with WhatsApp:');
  
  try {
    const qrUrl = await qrcode.toDataURL(qr);
    pairingCode = qrUrl;
    
    // Also save as file
    qrcode.toFile(path.join(__dirname, 'public', 'qr.png'), qr, (err) => {
      if (err) logger.error('Error saving QR code:', err);
    });
  } catch (err) {
    logger.error('Error generating QR code:', err);
  }
});

// Client ready
client.on('ready', () => {
  logger.info('✅ Bot is ready!');
  pairingCode = null;
});

// Incoming messages
client.on('message', async (msg) => {
  try {
    logger.info(`📨 Message from ${msg.from}: ${msg.body}`);

    // Execute plugins
    for (const plugin of plugins) {
      if (plugin.pattern && plugin.pattern.test(msg.body)) {
        try {
          await plugin.execute(msg, client);
        } catch (err) {
          logger.error(`Error executing plugin:`, err);
          msg.reply('❌ An error occurred while processing your request.');
        }
      }
    }
  } catch (err) {
    logger.error('Error handling message:', err);
  }
});

// Authentication failure
client.on('auth_failure', (msg) => {
  logger.error('❌ Authentication failed:', msg);
});

// Disconnected
client.on('disconnected', (reason) => {
  logger.warn('⚠️ Client was logged out:', reason);
});

// Initialize client
client.initialize();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🌐 Pairing server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  client.destroy();
  process.exit(0);
});

module.exports = { client, app, plugins };
