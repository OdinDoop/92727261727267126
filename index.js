const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { sendMessageUsingFBState, getFBState, testFBConnection } = require('./fb-handler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Config
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'test_token_123';
const WEBHOOK_MODE = process.env.WEBHOOK_MODE || 'facebook'; // 'facebook' or 'custom'

// ========== ROUTES ==========

// Home Page
app.get('/', (req, res) => {
  const fbState = getFBState();
  res.send(`
    <html>
      <head>
        <title>FB State Messenger Bot</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
          .card { background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0; }
          .success { color: green; }
          .error { color: red; }
          button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
          pre { background: #333; color: #fff; padding: 15px; border-radius: 5px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>🤖 FB State Messenger Bot</h1>
        <p>Server Time: ${new Date().toLocaleString()}</p>
        
        <div class="card">
          <h3>📊 Server Status</h3>
          <p>Port: ${PORT}</p>
          <p>Webhook Mode: ${WEBHOOK_MODE}</p>
          <p>FB State Loaded: ${fbState ? '✅ Yes' : '❌ No'}</p>
          <p>Cookies: ${fbState ? fbState.cookies.length : 0} cookies loaded</p>
        </div>
        
        <div class="card">
          <h3>🔗 Endpoints</h3>
          <ul>
            <li><a href="/health">/health</a> - Health check</li>
            <li><a href="/webhook">/webhook</a> - Facebook webhook</li>
            <li><a href="/test-fb">/test-fb</a> - Test FB connection</li>
            <li><a href="/send-message">/send-message</a> - Send test message</li>
            <li><a href="/fb-state">/fb-state</a> - View FB state info</li>
          </ul>
        </div>
        
        <div class="card">
          <h3>✏️ Send Test Message</h3>
          <form action="/send-message" method="POST">
            <input type="text" name="recipient" placeholder="Recipient ID" style="width: 200px; padding: 8px;" required>
            <input type="text" name="message" placeholder="Message" style="width: 300px; padding: 8px;" required>
            <button type="submit">Send</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'fb-state-messenger-bot',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    fb_state_loaded: getFBState() ? true : false
  });
});

// Facebook Webhook Verification (Standard)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('Facebook webhook verification attempt');
  
  if (mode && token === VERIFY_TOKEN) {
    console.log('✅ Facebook webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verification failed');
    res.sendStatus(403);
  }
});

// Custom Webhook for Direct Messaging (Alternative to Facebook's webhook)
app.post('/webhook', async (req, res) => {
  console.log('📨 Received webhook data:', JSON.stringify(req.body, null, 2));
  
  try {
    if (WEBHOOK_MODE === 'facebook' && req.body.object === 'page') {
      // Facebook's standard webhook format
      req.body.entry.forEach(entry => {
        entry.messaging.forEach(event => {
          if (event.message) {
            handleFacebookEvent(event);
          }
        });
      });
      res.status(200).send('EVENT_RECEIVED');
      
    } else if (WEBHOOK_MODE === 'custom') {
      // Custom webhook format for direct control
      const { recipient, message } = req.body;
      
      if (!recipient || !message) {
        return res.status(400).json({ error: 'recipient and message are required' });
      }
      
      const result = await sendMessageUsingFBState(recipient, message);
      res.json({
        success: true,
        message: 'Message sent via FB State',
        data: result
      });
      
    } else {
      res.status(400).json({ error: 'Invalid webhook mode or format' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test Facebook Connection
app.get('/test-fb', async (req, res) => {
  try {
    const result = await testFBConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Send Message Endpoint
app.get('/send-message', async (req, res) => {
  const recipient = req.query.recipient || process.env.TEST_RECIPIENT;
  const message = req.query.message || 'Hello from FB State Bot!';
  
  if (!recipient) {
    return res.json({ 
      error: 'No recipient specified. Add ?recipient=USER_ID&message=YOUR_MESSAGE' 
    });
  }
  
  try {
    const result = await sendMessageUsingFBState(recipient, message);
    res.json({
      success: true,
      message: 'Test message sent',
      data: result
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

app.post('/send-message', async (req, res) => {
  const { recipient, message } = req.body;
  
  if (!recipient || !message) {
    return res.status(400).json({ 
      error: 'Recipient and message are required' 
    });
  }
  
  try {
    const result = await sendMessageUsingFBState(recipient, message);
    res.json({
      success: true,
      message: 'Message sent successfully',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// View FB State Info
app.get('/fb-state', (req, res) => {
  const fbState = getFBState();
  
  if (!fbState) {
    return res.json({ error: 'No FB state loaded' });
  }
  
  res.json({
    cookies_count: fbState.cookies.length,
    user_id: fbState.userId,
    cookies: fbState.cookies.map(c => ({
      key: c.key,
      value: c.value.substring(0, 20) + '...',
      domain: c.domain
    })),
    loaded_from: fbState.source
  });
});

// ========== HANDLERS ==========

async function handleFacebookEvent(event) {
  const senderId = event.sender.id;
  const messageText = event.message.text;
  
  console.log(`💬 FB Event from ${senderId}: "${messageText}"`);
  
  // Auto-reply
  const reply = `You said: "${messageText}"\n\nTime: ${new Date().toLocaleTimeString()}`;
  
  try {
    await sendMessageUsingFBState(senderId, reply);
    console.log(`✅ Auto-reply sent to ${senderId}`);
  } catch (error) {
    console.error(`❌ Failed to reply to ${senderId}:`, error.message);
  }
}

// ========== SERVER START ==========

app.listen(PORT, () => {
  console.log(`
🚀 FB State Messenger Bot Started!
─────────────────────────────────
📍 Port: ${PORT}
📞 Health: http://localhost:${PORT}/health
🔗 Webhook: http://localhost:${PORT}/webhook
📝 Mode: ${WEBHOOK_MODE}
🎯 Using FB State from: account.txt
─────────────────────────────────
  `);
  
  // Test FB connection on startup
  testFBConnection().then(result => {
    console.log('📡 FB Connection Test:', result.success ? '✅ Success' : '❌ Failed');
  }).catch(error => {
    console.log('⚠️  FB Connection Test Failed:', error.message);
  });
});