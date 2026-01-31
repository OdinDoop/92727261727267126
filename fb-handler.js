const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class FBStateHandler {
  constructor() {
    this.accountFile = 'account.txt';
    this.cookies = [];
    this.userId = null;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.loadFBState();
  }

  // Load cookies from account.txt
  loadFBState() {
    try {
      if (!fs.existsSync(this.accountFile)) {
        console.error('❌ account.txt not found');
        return false;
      }

      const data = fs.readFileSync(this.accountFile, 'utf8');
      const cookies = JSON.parse(data);
      
      this.cookies = cookies;
      
      // Find user ID from cookies
      const cUser = cookies.find(c => c.key === 'c_user');
      if (cUser) {
        this.userId = cUser.value;
        console.log(`✅ Loaded FB State for user: ${this.userId}`);
        console.log(`✅ Total cookies: ${cookies.length}`);
      } else {
        console.warn('⚠️  c_user cookie not found');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Failed to load FB state:', error.message);
      return false;
    }
  }

  // Convert cookies to string for headers
  getCookieString() {
    return this.cookies
      .map(cookie => `${cookie.key}=${cookie.value}`)
      .join('; ');
  }

  // Get XS token (important for API calls)
  getXSToken() {
    const xsCookie = this.cookies.find(c => c.key === 'xs');
    return xsCookie ? xsCookie.value : null;
  }

  // Get C_USER
  getCUser() {
    const cUser = this.cookies.find(c => c.key === 'c_user');
    return cUser ? cUser.value : null;
  }

  // Test Facebook connection
  async testConnection() {
    try {
      const response = await axios.get('https://www.facebook.com/api/graphql/', {
        headers: {
          'Cookie': this.getCookieString(),
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': 'https://www.facebook.com/',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        params: {
          'av': this.userId,
          '__user': this.userId,
          '__a': 1
        },
        timeout: 10000
      });

      return {
        success: true,
        status: response.status,
        data: response.data,
        message: 'Facebook connection successful'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      };
    }
  }

  // Send message using FB Graph API
  async sendMessage(recipientId, message) {
    try {
      const xsToken = this.getXSToken();
      const cUser = this.getCUser();
      
      if (!xsToken || !cUser) {
        throw new Error('Missing required cookies (xs or c_user)');
      }

      // Method 1: Using Graph API with cookie authentication
      const response = await axios.post(
        `https://www.facebook.com/api/graphql/`,
        new URLSearchParams({
          'av': cUser,
          '__user': cUser,
          '__a': 1,
          '__req': '1',
          'fb_api_caller_class': 'RelayModern',
          'fb_api_req_friendly_name': 'MessengerSendMessageMutation',
          'variables': JSON.stringify({
            "input": {
              "client_mutation_id": "1",
              "actor_id": cUser,
              "offline_threading_id": Date.now().toString(),
              "message": {
                "text": message
              },
              "thread_id": recipientId,
              "sync_group": 1
            }
          }),
          'server_timestamps': 'true',
          'doc_id': '6663272400232946' // Messenger send message mutation ID
        }),
        {
          headers: {
            'Cookie': this.getCookieString(),
            'User-Agent': this.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.facebook.com',
            'Referer': `https://www.facebook.com/messages/t/${recipientId}`,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-FB-Friendly-Name': 'MessengerSendMessageMutation',
            'X-FB-LSD': this.getLSDToken() || 'AVpVf4g5'
          }
        }
      );

      return {
        success: true,
        method: 'graphql',
        recipient: recipientId,
        message: message,
        response: response.data
      };

    } catch (error) {
      console.error('GraphQL send failed:', error.message);
      
      // Fallback method: Try m.me endpoint
      return await this.sendMessageFallback(recipientId, message);
    }
  }

  // Fallback method using m.me
  async sendMessageFallback(recipientId, message) {
    try {
      const formData = new FormData();
      formData.append('ids[0]', recipientId);
      formData.append('body', message);
      formData.append('waterfall_source', 'message');
      
      const response = await axios.post(
        'https://www.facebook.com/messaging/send/',
        formData,
        {
          headers: {
            'Cookie': this.getCookieString(),
            'User-Agent': this.userAgent,
            'Origin': 'https://www.facebook.com',
            'Referer': `https://www.facebook.com/messages/t/${recipientId}`,
            ...formData.getHeaders()
          }
        }
      );

      return {
        success: true,
        method: 'fallback',
        recipient: recipientId,
        message: message,
        response: response.data
      };
    } catch (error) {
      throw new Error(`Both methods failed: ${error.message}`);
    }
  }

  // Extract LSD token from cookies (if exists)
  getLSDToken() {
    // LSD token might be in cookies or need to be fetched
    // For now, return a placeholder
    return null;
  }

  // Get user info
  async getUserInfo() {
    try {
      const response = await axios.get('https://www.facebook.com/me', {
        headers: {
          'Cookie': this.getCookieString(),
          'User-Agent': this.userAgent
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const fbHandler = new FBStateHandler();

// Export functions
module.exports = {
  sendMessageUsingFBState: (recipient, message) => fbHandler.sendMessage(recipient, message),
  testFBConnection: () => fbHandler.testConnection(),
  getFBState: () => ({
    cookies: fbHandler.cookies,
    userId: fbHandler.userId,
    source: 'account.txt'
  }),
  getUserInfo: () => fbHandler.getUserInfo()
};