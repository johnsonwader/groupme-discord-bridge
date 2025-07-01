// GroupMe-Discord Bridge - Main Application File with Reaction Support
const https = require('https');
const http = require('http');
const url = require('url');

// Environment variables
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GROUPME_BOT_ID = process.env.GROUPME_BOT_ID;
const GROUPME_ACCESS_TOKEN = process.env.GROUPME_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body, headers: res.headers });
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

// Get original message from GroupMe API
async function getGroupMeMessage(groupId, messageId) {
  const options = {
    hostname: 'api.groupme.com',
    port: 443,
    path: `/v3/groups/${groupId}/messages/${messageId}?token=${GROUPME_ACCESS_TOKEN}`,
    method: 'GET',
    protocol: 'https:',
    headers: {
      'User-Agent': 'GroupMe-Discord-Bridge/1.0'
    }
  };

  try {
    const response = await makeRequest(options);
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      return data.response.message;
    }
    return null;
  } catch (error) {
    console.error('Error fetching GroupMe message:', error);
    return null;
  }
}

// Convert GroupMe reaction emoji to Discord format
function convertReactionEmoji(groupmeEmoji) {
  // GroupMe uses different emoji formats, this maps common ones
  const emojiMap = {
    '❤': '❤️',
    '👍': '👍',
    '👎': '👎',
    '😂': '😂', 
    '😢': '😢',
    '😮': '😮',
    '😡': '😡',
    '👏': '👏',
    '🪩': '🪩'
  };
  
  return emojiMap[groupmeEmoji] || groupmeEmoji;
}

// Send message to Discord
async function sendToDiscord(message) {
  const webhookUrl = new URL(DISCORD_WEBHOOK_URL);
  
  const payload = {
    username: message.name || 'GroupMe User',
    content: message.text || '[No text content]',
    avatar_url: message.avatar_url
  };

  // Handle image attachments
  if (message.attachments && message.attachments.length > 0) {
    const images = message.attachments.filter(att => att.type === 'image');
    if (images.length > 0) {
      payload.embeds = images.map(img => ({ image: { url: img.url } }));
    }
  }

  const options = {
    hostname: webhookUrl.hostname,
    port: webhookUrl.port || 443,
    path: webhookUrl.pathname,
    method: 'POST',
    protocol: webhookUrl.protocol,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GroupMe-Discord-Bridge/1.0'
    }
  };

  try {
    const response = await makeRequest(options, JSON.stringify(payload));
    console.log('Message sent to Discord:', response.statusCode);
    return response.statusCode < 300;
  } catch (error) {
    console.error('Error sending to Discord:', error);
    return false;
  }
}

// Send reaction notification to Discord
async function sendReactionToDiscord(reactionData, originalMessage) {
  const webhookUrl = new URL(DISCORD_WEBHOOK_URL);
  
  const emoji = convertReactionEmoji(reactionData.favorited_by.emoji || '❤️');
  const reacterName = reactionData.favorited_by.nickname || 'Someone';
  
  // Create a preview of the original message (truncate if too long)
  let messagePreview = originalMessage.text || '[No text content]';
  if (messagePreview.length > 100) {
    messagePreview = messagePreview.substring(0, 97) + '...';
  }
  
  const payload = {
    username: 'GroupMe Reactions',
    content: `${emoji} **${reacterName}** reacted to: "${messagePreview}"`,
    avatar_url: reactionData.favorited_by.image_url || null
  };

  const options = {
    hostname: webhookUrl.hostname,
    port: webhookUrl.port || 443,
    path: webhookUrl.pathname,
    method: 'POST',
    protocol: webhookUrl.protocol,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GroupMe-Discord-Bridge/1.0'
    }
  };

  try {
    const response = await makeRequest(options, JSON.stringify(payload));
    console.log('Reaction sent to Discord:', response.statusCode);
    return response.statusCode < 300;
  } catch (error) {
    console.error('Error sending reaction to Discord:', error);
    return false;
  }
}

// Send message to GroupMe
async function sendToGroupMe(message) {
  const payload = {
    bot_id: GROUPME_BOT_ID,
    text: `${message.author}: ${message.content}`
  };

  const options = {
    hostname: 'api.groupme.com',
    port: 443,
    path: '/v3/bots/post',
    method: 'POST',
    protocol: 'https:',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'GroupMe-Discord-Bridge/1.0'
    }
  };

  try {
    const response = await makeRequest(options, JSON.stringify(payload));
    console.log('Message sent to GroupMe:', response.statusCode);
    return response.statusCode < 300;
  } catch (error) {
    console.error('Error sending to GroupMe:', error);
    return false;
  }
}

// Handle GroupMe webhook data
async function handleGroupMeWebhook(data) {
  // Handle regular messages
  if (data.sender_type === 'bot') {
    // Ignore bot messages to prevent loops
    return { success: true, ignored: true };
  }
  
  // Handle reaction events
  if (data.favorited_by && data.favorited_by.length > 0) {
    console.log('Received GroupMe reaction event');
    
    // Get the most recent reaction (last item in favorited_by array)
    const latestReaction = data.favorited_by[data.favorited_by.length - 1];
    
    // Create reaction data object
    const reactionData = {
      favorited_by: latestReaction,
      message_id: data.id,
      group_id: data.group_id
    };
    
    // Send reaction to Discord
    const success = await sendReactionToDiscord(reactionData, data);
    return { success, type: 'reaction' };
  }
  
  // Handle regular message
  const success = await sendToDiscord(data);
  return { success, type: 'message' };
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  
  if (req.method === 'GET' && parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>GroupMe-Discord Bridge</title></head>
        <body>
          <h1>GroupMe-Discord Bridge is Running!</h1>
          <p>Features:</p>
          <ul>
            <li>✅ Message bridging</li>
            <li>✅ Image attachments</li>
            <li>✅ Reaction notifications</li>
          </ul>
          <p>Webhook endpoints:</p>
          <ul>
            <li>GroupMe webhook: <code>/groupme</code></li>
            <li>Discord webhook: <code>/discord</code></li>
          </ul>
          <p>Required environment variables:</p>
          <ul>
            <li><code>DISCORD_WEBHOOK_URL</code></li>
            <li><code>GROUPME_BOT_ID</code></li>
            <li><code>GROUPME_ACCESS_TOKEN</code> (required for reactions)</li>
          </ul>
        </body>
      </html>
    `);
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        
        if (parsedUrl.pathname === '/groupme') {
          // Handle GroupMe webhook
          const result = await handleGroupMeWebhook(data);
          res.writeHead(result.success ? 200 : 500);
          res.end(JSON.stringify(result));
          
        } else if (parsedUrl.pathname === '/discord') {
          // Handle Discord webhook (if implementing two-way sync)
          if (data.webhook_id || (data.author && data.author.bot)) {
            // Ignore webhook/bot messages to prevent loops
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, ignored: true }));
            return;
          }
          
          const success = await sendToGroupMe(data);
          res.writeHead(success ? 200 : 500);
          res.end(JSON.stringify({ success }));
          
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`GroupMe-Discord Bridge running on port ${PORT}`);
  console.log(`GroupMe webhook URL: http://localhost:${PORT}/groupme`);
  console.log(`Discord webhook URL: http://localhost:${PORT}/discord`);
  
  // Check if required environment variables are set
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('⚠️  DISCORD_WEBHOOK_URL not set');
  }
  if (!GROUPME_BOT_ID) {
    console.warn('⚠️  GROUPME_BOT_ID not set');
  }
  if (!GROUPME_ACCESS_TOKEN) {
    console.warn('⚠️  GROUPME_ACCESS_TOKEN not set (required for reactions)');
  }
});
