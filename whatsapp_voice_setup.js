// WhatsApp Voice Integration for ODIA 11-Agent System
// Handles voice messages, converts to text, processes with agents, responds with voice

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs').promises;

class WhatsAppVoiceIntegration {
    constructor() {
        this.whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        this.elevenLabsKey = process.env.ELEVENLABS_API_KEY;
        this.openAIKey = process.env.OPENAI_API_KEY;
        this.claudeKey = process.env.CLAUDE_API_KEY;
        
        this.setupRoutes();
    }

    setupRoutes() {
        const app = express();
        const upload = multer({ dest: 'temp/' });
        
        app.use(express.json());
        
        // WhatsApp webhook endpoint
        app.post('/api/webhook/whatsapp', this.handleWhatsAppWebhook.bind(this));
        
        // Manual voice processing endpoint
        app.post('/api/process-voice', upload.single('audio'), this.processVoiceFile.bind(this));
        
        // Test voice agent endpoint
        app.post('/api/test-voice-agent/:agentId', this.testVoiceAgent.bind(this));
        
        return app;
    }

    async handleWhatsAppWebhook(req, res) {
        try {
            const body = req.body;
            
            // Verify webhook
            if (req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
                return res.status(200).send(req.query['hub.challenge']);
            }

            // Process incoming messages
            if (body.object === 'whatsapp_business_account') {
                for (const entry of body.entry) {
                    for (const change of entry.changes) {
                        if (change.field === 'messages') {
                            await this.processWhatsAppMessage(change.value);
                        }
                    }
                }
            }

            res.status(200).send('OK');
        } catch (error) {
            console.error('WhatsApp webhook error:', error);
            res.status(500).send('Error processing webhook');
        }
    }

    async processWhatsAppMessage(messageData) {
        const messages = messageData.messages;
        if (!messages) return;

        for (const message of messages) {
            const phoneNumber = message.from;
            const messageId = message.id;

            // Handle different message types
            if (message.type === 'audio') {
                await this.handleVoiceMessage(phoneNumber, message.audio, messageId);
            } else if (message.type === 'text') {
                await this.handleTextMessage(phoneNumber, message.text.body, messageId);
            }
        }
    }

    async handleVoiceMessage(phoneNumber, audioData, messageId) {
        try {
            console.log(`🎤 Processing voice message from ${phoneNumber}`);
            
            // Step 1: Download audio from WhatsApp
            const audioBuffer = await this.downloadWhatsAppAudio(audioData.id);
            
            // Step 2: Convert speech to text
            const transcription = await this.speechToText(audioBuffer);
            console.log(`📝 Transcription: ${transcription}`);
            
            // Step 3: Determine which agent to use
            const agentId = await this.selectAgent(transcription, phoneNumber);
            
            // Step 4: Get agent response
            const agentResponse = await this.getAgentResponse(agentId, transcription, {
                source: 'whatsapp_voice',
                phone_number: phoneNumber,
                message_id: messageId
            });
            
            // Step 5: Convert response to speech
            const voiceResponse = await this.textToSpeech(agentResponse, agentId);
            
            // Step 6: Send voice response via WhatsApp
            await this.sendWhatsAppVoiceMessage(phoneNumber, voiceResponse);
            
            // Step 7: Log interaction
            await this.logVoiceInteraction(agentId, phoneNumber, transcription, agentResponse);
            
            console.log(`✅ Voice interaction completed for ${phoneNumber}`);
            
        } catch (error) {
            console.error('Voice message processing error:', error);
            
            // Send error message as text
            await this.sendWhatsAppTextMessage(phoneNumber, 
                "Sorry, I couldn't process your voice message. Please try again or send a text message."
            );
        }
    }

    async handleTextMessage(phoneNumber, textContent, messageId) {
        try {
            // Check if this is an email command
            if (this.isEmailCommand(textContent)) {
                await this.handleEmailCommand(phoneNumber, textContent);
                return;
            }
            
            // Process as regular text message
            const agentId = await this.selectAgent(textContent, phoneNumber);
            const response = await this.getAgentResponse(agentId, textContent, {
                source: 'whatsapp_text',
                phone_number: phoneNumber,
                message_id: messageId
            });
            
            await this.sendWhatsAppTextMessage(phoneNumber, response);
            
        } catch (error) {
            console.error('Text message processing error:', error);
            await this.sendWhatsAppTextMessage(phoneNumber, 
                "Sorry, I encountered an error. Please try again."
            );
        }
    }

    async downloadWhatsAppAudio(mediaId) {
        try {
            // Get media URL from WhatsApp
            const mediaInfoResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: {
                    'Authorization': `Bearer ${this.whatsappToken}`
                }
            });
            
            const mediaInfo = await mediaInfoResponse.json();
            
            // Download the actual audio file
            const audioResponse = await fetch(mediaInfo.url, {
                headers: {
                    'Authorization': `Bearer ${this.whatsappToken}`
                }
            });
            
            return await audioResponse.buffer();
            
        } catch (error) {
            console.error('Error downloading WhatsApp audio:', error);
            throw error;
        }
    }

    async speechToText(audioBuffer) {
        try {
            // Save audio buffer to temporary file
            const tempFilePath = `/tmp/audio_${Date.now()}.ogg`;
            await fs.writeFile(tempFilePath, audioBuffer);
            
            // Create form data for OpenAI Whisper
            const formData = new FormData();
            formData.append('file', await fs.readFile(tempFilePath), {
                filename: 'audio.ogg',
                contentType: 'audio/ogg'
            });
            formData.append('model', 'whisper-1');
            formData.append('language', 'en'); // Can be dynamically detected
            
            // Send to OpenAI Whisper
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openAIKey}`,
                    ...formData.getHeaders()
                },
                body: formData
            });
            
            const result = await response.json();
            
            // Clean up temporary file
            await fs.unlink(tempFilePath).catch(() => {});
            
            return result.text;
            
        } catch (error) {
            console.error('Speech to text error:', error);
            throw error;
        }
    }

    async textToSpeech(text, agentId) {
        try {
            const voiceId = this.getVoiceIdForAgent(agentId);
            
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.elevenLabsKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.75,
                        similarity_boost: 0.85,
                        style: 0.5,
                        use_speaker_boost: true
                    }
                })
            });
            
            return await response.buffer();
            
        } catch (error) {
            console.error('Text to speech error:', error);
            throw error;
        }
    }

    async selectAgent(messageContent, phoneNumber) {
        // Agent selection logic based on message content and user preferences
        const content = messageContent.toLowerCase();
        
        // Legal keywords
        if (content.includes('contract') || content.includes('legal') || content.includes('cac') || 
            content.includes('registration') || content.includes('lawyer')) {
            return 'miss-legal';
        }
        
        // Payment keywords
        if (content.includes('payment') || content.includes('pay') || content.includes('invoice') || 
            content.includes('money') || content.includes('flutterwave')) {
            return 'paymaster';
        }
        
        // Business analysis keywords
        if (content.includes('business') || content.includes('market') || content.includes('analysis') || 
            content.includes('strategy') || content.includes('plan')) {
            return 'atlas-corporate';
        }
        
        // Emergency keywords
        if (content.includes('emergency') || content.includes('help') || content.includes('urgent') || 
            content.includes('crisis')) {
            return 'crossai-emergency';
        }
        
        // Education keywords
        if (content.includes('university') || content.includes('school') || content.includes('admission') || 
            content.includes('student') || content.includes('jamb')) {
            return 'miss-academic';
        }
        
        // Technical support keywords
        if (content.includes('technical') || content.includes('system') || content.includes('software') || 
            content.includes('computer') || content.includes('app')) {
            return 'tech-support';
        }
        
        // Luxury service keywords
        if (content.includes('luxury') || content.includes('vip') || content.includes('premium') || 
            content.includes('travel') || content.includes('booking')) {
            return 'luxury-service';
        }
        
        // Medical keywords
        if (content.includes('health') || content.includes('medical') || content.includes('doctor') || 
            content.includes('hospital') || content.includes('appointment')) {
            return 'med-assist';
        }
        
        // Kids education keywords
        if (content.includes('kids') || content.includes('children') || content.includes('learning') || 
            content.includes('games') || content.includes('education')) {
            return 'edu-kids';
        }
        
        // Government service keywords
        if (content.includes('government') || content.includes('official') || content.includes('document') || 
            content.includes('service') || content.includes('form')) {
            return 'gov-connect';
        }
        
        // Default to Lexi Pro for general queries
        return 'lexi-pro';
    }

    async getAgentResponse(agentId, message, context) {
        try {
            // Get agent configuration
            const agentConfig = await this.getAgentConfig(agentId);
            
            // Prepare Claude prompt with agent context
            const prompt = this.buildAgentPrompt(agentConfig, message, context);
            
            // Call Claude API
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.claudeKey}`,
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-sonnet-20240229',
                    max_tokens: 500,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                })
            });
            
            const result = await response.json();
            return result.content[0].text;
            
        } catch (error) {
            console.error('Agent response error:', error);
            return "I apologize, but I'm experiencing technical difficulties. Please try again.";
        }
    }

    buildAgentPrompt(agentConfig, message, context) {
        return `You are ${agentConfig.name}, a specialized AI agent in the ODIA AI system.

Your capabilities: ${agentConfig.capabilities.join(', ')}
Supported languages: ${agentConfig.languages.join(', ')}
Context: ${JSON.stringify(context)}

User message: "${message}"

Instructions:
- Respond professionally in Nigerian English or the user's preferred Nigerian language
- Be helpful, accurate, and culturally sensitive
- Keep responses concise but informative for voice delivery
- If the request requires your specific capabilities, provide detailed assistance
- If outside your scope, politely redirect to the appropriate agent

Respond as ${agentConfig.name}:`;
    }

    async sendWhatsAppVoiceMessage(phoneNumber, audioBuffer) {
        try {
            // Upload audio to WhatsApp first
            const mediaId = await this.uploadWhatsAppMedia(audioBuffer, 'audio/mpeg');
            
            // Send voice message
            const response = await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: phoneNumber,
                    type: 'audio',
                    audio: {
                        id: mediaId
                    }
                })
            });
            
            const result = await response.json();
            console.log('Voice message sent:', result);
            return result;
            
        } catch (error) {
            console.error('Error sending WhatsApp voice message:', error);
            throw error;
        }
    }

    async sendWhatsAppTextMessage(phoneNumber, message) {
        try {
            const response = await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: phoneNumber,
                    type: 'text',
                    text: {
                        body: message
                    }
                })
            });
            
            const result = await response.json();
            return result;
            
        } catch (error) {
            console.error('Error sending WhatsApp text message:', error);
            throw error;
        }
    }

    async uploadWhatsAppMedia(mediaBuffer, mimeType) {
        try {
            const formData = new FormData();
            formData.append('file', mediaBuffer, {
                filename: 'audio.mp3',
                contentType: mimeType
            });
            formData.append('messaging_product', 'whatsapp');
            
            const response = await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.whatsappToken}`,
                    ...formData.getHeaders()
                },
                body: formData
            });
            
            const result = await response.json();
            return result.id;
            
        } catch (error) {
            console.error('Error uploading media to WhatsApp:', error);
            throw error;
        }
    }

    getVoiceIdForAgent(agentId) {
        const voiceMap = {
            'lexi-pro': 'atxzO10LEsk8kEval3af',
            'atlas-corporate': 'bVMeCyTHy58xNoL34h3p',
            'miss-legal': 'ThT5KcBeYPX3keUQqHPh',
            'paymaster': 'LcfcDJNUP1GQjkzn1xUU',
            'crossai-emergency': 'EXAVITQu4vr4xnSDxMaE',
            'miss-academic': 'pNInz6obpgDQGcFmaJgB',
            'tech-support': 'VR6AewLTigWG4xSOukaG',
            'luxury-service': 'TxGEqnHWrfWFTfGW9XjX',
            'med-assist': 'jsCqWAovK2LkecY7zXl4',
            'edu-kids': 'onwK4e9ZLuTAKqWW03F9',
            'gov-connect': 'IKne3meq5aSn9XLyUdCD'
        };
        
        return voiceMap[agentId] || voiceMap['lexi-pro'];
    }

    async getAgentConfig(agentId) {
        // This would query your Supabase database
        // For now, returning mock data
        const configs = {
            'lexi-pro': {
                name: 'Agent Lexi Pro',
                capabilities: ['whatsapp_automation', 'email_generation', 'voice_conversations', 'customer_support'],
                languages: ['english', 'pidgin', 'yoruba', 'hausa', 'igbo']
            },
            'miss-legal': {
                name: 'Agent Miss Legal',
                capabilities: ['cac_registration', 'legal_documents', 'contract_templates', 'ndpr_compliance'],
                languages: ['english']
            }
            // Add other agent configs...
        };
        
        return configs[agentId] || configs['lexi-pro'];
    }

    async logVoiceInteraction(agentId, phoneNumber, transcription, response) {
        // Log to Supabase database
        console.log(`Logging voice interaction: ${agentId} -> ${phoneNumber}`);
        // Implementation would insert into voice_interactions table
    }

    // Email command detection and handling
    isEmailCommand(text) {
        const emailKeywords = ['send email', 'email to', 'compose email', 'draft email'];
        return emailKeywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    async handleEmailCommand(phoneNumber, textContent) {
        // Parse email command and trigger email generation
        // This will be implemented in the email automation section
        await this.sendWhatsAppTextMessage(phoneNumber, 
            "📧 Email command detected! I'll help you compose and send that email. Please provide recipient and content details."
        );
    }

    // Test endpoint for voice agent functionality
    async testVoiceAgent(req, res) {
        try {
            const agentId = req.params.agentId;
            const testMessage = req.body.message || "Hello, this is a test message";
            
            const response = await this.getAgentResponse(agentId, testMessage, {
                source: 'test',
                test_mode: true
            });
            
            const voiceBuffer = await this.textToSpeech(response, agentId);
            
            res.json({
                agent_id: agentId,
                input_message: testMessage,
                text_response: response,
                voice_response_size: voiceBuffer.length,
                status: 'success'
            });
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

// Initialize and export
const whatsappVoice = new WhatsAppVoiceIntegration();
module.exports = whatsappVoice;

// Usage example:
/*
1. Setup WhatsApp Business API webhook pointing to your server
2. Configure environment variables for all services
3. Deploy this code to your server (Vercel, AWS, etc.)
4. Test by sending voice messages to your WhatsApp Business number

Example WhatsApp voice flow:
1. User sends voice message: "I need help with CAC registration"
2. System converts speech to text
3. Selects miss-legal agent based on content
4. Agent processes request and generates response
5. Response converted to speech using Nigerian voice
6. Voice response sent back via WhatsApp

The system automatically handles:
- Voice message downloading from WhatsApp
- Speech-to-text conversion with Nigerian accent support
- Intelligent agent selection based on content
- Agent response generation with Claude
- Text-to-speech with Nigerian voices
- Voice message upload and delivery via WhatsApp
*/