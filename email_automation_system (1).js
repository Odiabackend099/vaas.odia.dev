// Email Automation System for ODIA 11-Agent System
// Handles: WhatsApp -> Email sending, Auto-replies, Email parsing, Smart email generation

const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const imap = require('imap');
const mailparser = require('mailparser');
const express = require('express');

class EmailAutomationSystem {
    constructor() {
        this.gmailClient = null;
        this.imapClient = null;
        this.transporter = null;
        
        this.setupGmailAuth();
        this.setupEmailMonitoring();
        this.setupRoutes();
        
        // Email templates and rules storage
        this.autoReplyRules = new Map();
        this.emailTemplates = new Map();
        
        this.initializeEmailTemplates();
    }

    // ===========================================
    // GMAIL API AUTHENTICATION & SETUP
    // ===========================================

    async setupGmailAuth() {
        try {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET,
                process.env.GMAIL_REDIRECT_URI
            );

            // Set credentials (you'll need to handle OAuth flow separately)
            oauth2Client.setCredentials({
                refresh_token: process.env.GMAIL_REFRESH_TOKEN
            });

            this.gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
            
            // Setup SMTP transporter
            const accessToken = await oauth2Client.getAccessToken();
            this.transporter = nodemailer.createTransporter({
                service: 'gmail',
                auth: {
                    type: 'OAuth2',
                    user: process.env.GMAIL_USER_EMAIL,
                    clientId: process.env.GMAIL_CLIENT_ID,
                    clientSecret: process.env.GMAIL_CLIENT_SECRET,
                    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
                    accessToken: accessToken.token
                }
            });

            console.log('✅ Gmail authentication setup complete');
            
        } catch (error) {
            console.error('Gmail authentication error:', error);
        }
    }

    setupRoutes() {
        const app = express();
        app.use(express.json());

        // WhatsApp to Email endpoints
        app.post('/api/whatsapp-to-email', this.handleWhatsAppToEmail.bind(this));
        app.post('/api/compose-email/:agentId', this.composeEmailWithAgent.bind(this));
        
        // Email auto-reply management
        app.post('/api/setup-auto-reply', this.setupAutoReply.bind(this));
        app.get('/api/auto-reply-rules/:userEmail', this.getAutoReplyRules.bind(this));
        app.delete('/api/auto-reply-rules/:ruleId', this.deleteAutoReplyRule.bind(this));
        
        // Email monitoring endpoints
        app.get('/api/email-logs/:agentId', this.getEmailLogs.bind(this));
        app.post('/api/test-email-system', this.testEmailSystem.bind(this));
        
        return app;
    }

    // ===========================================
    // WHATSAPP TO EMAIL BRIDGE
    // ===========================================

    async handleWhatsAppToEmail(req, res) {
        try {
            const { phoneNumber, message, agentId = 'lexi-pro' } = req.body;
            
            // Parse email command from WhatsApp message
            const emailData = this.parseEmailCommand(message);
            
            if (!emailData.isEmailCommand) {
                return res.status(400).json({
                    error: 'Not an email command',
                    suggestion: 'Use format: "Send email to user@example.com about [subject] - [message]"'
                });
            }

            // Generate email content using specified agent
            const emailContent = await this.generateEmailWithAgent(agentId, emailData);
            
            // Send the email
            const emailResult = await this.sendEmail({
                to: emailData.recipient,
                subject: emailContent.subject,
                body: emailContent.body,
                from_agent: agentId,
                source: 'whatsapp',
                source_phone: phoneNumber
            });

            // Confirm via WhatsApp
            await this.sendWhatsAppConfirmation(phoneNumber, emailResult, emailData.recipient);
            
            // Log the interaction
            await this.logEmailInteraction(agentId, phoneNumber, emailData, emailResult);

            res.json({
                success: true,
                email_sent: true,
                message_id: emailResult.messageId,
                recipient: emailData.recipient,
                agent_used: agentId
            });

        } catch (error) {
            console.error('WhatsApp to Email error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    parseEmailCommand(message) {
        const emailPatterns = [
            /send email to (.+?) about (.+?) - (.+)/i,
            /email (.+?) subject: (.+?) body: (.+)/i,
            /compose email to (.+?): (.+)/i,
            /send (.+?) an email about (.+)/i
        ];

        for (const pattern of emailPatterns) {
            const match = message.match(pattern);
            if (match) {
                return {
                    isEmailCommand: true,
                    recipient: this.extractEmail(match[1]),
                    subject: match[2] || 'Message from ODIA AI',
                    content: match[3] || match[2],
                    originalMessage: message
                };
            }
        }

        // Check for simple email patterns
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        const emailMatch = message.match(emailRegex);
        
        if (emailMatch && (message.toLowerCase().includes('email') || message.toLowerCase().includes('send'))) {
            return {
                isEmailCommand: true,
                recipient: emailMatch[1],
                subject: 'Message from ODIA AI Assistant',
                content: message.replace(emailMatch[1], '').replace(/email|send/gi, '').trim(),
                originalMessage: message
            };
        }

        return { isEmailCommand: false };
    }

    extractEmail(text) {
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        const match = text.match(emailRegex);
        return match ? match[1] : text.trim();
    }

    async generateEmailWithAgent(agentId, emailData) {
        try {
            const prompt = `As ${this.getAgentName(agentId)}, compose a professional email based on this request:

Recipient: ${emailData.recipient}
Subject: ${emailData.subject}
Content request: ${emailData.content}

Generate:
1. A refined subject line
2. A professional email body appropriate for Nigerian business context
3. Proper greetings and closing

Response format:
{
  "subject": "refined subject line",
  "body": "complete email body with greeting and closing"
}`;

            const agentResponse = await this.getAgentResponse(agentId, prompt);
            
            try {
                return JSON.parse(agentResponse);
            } catch {
                // Fallback if JSON parsing fails
                return {
                    subject: emailData.subject,
                    body: this.generateFallbackEmail(emailData, agentId)
                };
            }

        } catch (error) {
            console.error('Email generation error:', error);
            return {
                subject: emailData.subject,
                body: this.generateFallbackEmail(emailData, agentId)
            };
        }
    }

    generateFallbackEmail(emailData, agentId) {
        const agentName = this.getAgentName(agentId);
        return `Dear Recipient,

I hope this email finds you well.

${emailData.content}

This message was sent via ODIA AI's ${agentName} assistant, Nigeria's most advanced voice AI infrastructure platform.

Best regards,
${agentName}
ODIA AI Assistant

--
Powered by ODIA AI
Nigeria's First Voice AI Infrastructure Company
Website: https://odia.dev
WhatsApp: +234-814-199-5397`;
    }

    async sendEmail(emailOptions) {
        try {
            const mailOptions = {
                from: `${emailOptions.from_agent || 'ODIA AI'} <${process.env.GMAIL_USER_EMAIL}>`,
                to: emailOptions.to,
                subject: emailOptions.subject,
                html: this.formatEmailHTML(emailOptions.body, emailOptions.from_agent),
                text: emailOptions.body,
                headers: {
                    'X-ODIA-Agent': emailOptions.from_agent || 'unknown',
                    'X-ODIA-Source': emailOptions.source || 'system'
                }
            };

            const result = await this.transporter.sendMail(mailOptions);
            
            console.log(`✅ Email sent successfully: ${result.messageId}`);
            
            // Store in database
            await this.storeEmailLog({
                ...emailOptions,
                message_id: result.messageId,
                status: 'sent',
                sent_at: new Date()
            });

            return {
                success: true,
                messageId: result.messageId,
                recipient: emailOptions.to,
                agent: emailOptions.from_agent
            };

        } catch (error) {
            console.error('Email sending error:', error);
            
            // Store failed attempt
            await this.storeEmailLog({
                ...emailOptions,
                status: 'failed',
                error: error.message,
                attempted_at: new Date()
            });

            throw error;
        }
    }

    formatEmailHTML(body, agentName) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message from ${agentName}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #25D366, #1B5E20); color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .footer { background: #2c3e50; color: white; padding: 15px; text-align: center; font-size: 12px; }
        .logo { font-size: 24px; font-weight: bold; }
        .agent-info { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #25D366; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🇳🇬 ODIA AI</div>
        <p>Message from ${agentName}</p>
    </div>
    
    <div class="content">
        ${body.replace(/\n/g, '<br>')}
        
        <div class="agent-info">
            <strong>About ${agentName}:</strong><br>
            This message was generated by ${agentName}, part of Nigeria's most advanced AI infrastructure platform.
        </div>
    </div>
    
    <div class="footer">
        <p><strong>ODIA AI LTD</strong> - Nigeria's First Voice AI Infrastructure Company</p>
        <p>🌐 <a href="https://odia.dev" style="color: #25D366;">odia.dev</a> | 📱 WhatsApp: +234-814-199-5397</p>
        <p>Proudly Nigerian 🇳🇬 | Building the future of African AI</p>
    </div>
</body>
</html>`;
    }

    // ===========================================
    // EMAIL AUTO-REPLY SYSTEM
    // ===========================================

    async setupEmailMonitoring() {
        try {
            // Setup IMAP connection for real-time email monitoring
            this.imapClient = new imap({
                user: process.env.GMAIL_USER_EMAIL,
                password: process.env.GMAIL_APP_PASSWORD, // App-specific password
                host: 'imap.gmail.com',
                port: 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false }
            });

            this.imapClient.once('ready', () => {
                console.log('✅ IMAP connection ready for email monitoring');
                this.startEmailMonitoring();
            });

            this.imapClient.once('error', (err) => {
                console.error('IMAP connection error:', err);
            });

            this.imapClient.connect();

        } catch (error) {
            console.error('Email monitoring setup error:', error);
        }
    }

    async startEmailMonitoring() {
        try {
            this.imapClient.openBox('INBOX', false, (err, box) => {
                if (err) {
                    console.error('Error opening inbox:', err);
                    return;
                }

                console.log('📧 Monitoring inbox for new emails...');

                // Listen for new emails
                this.imapClient.on('mail', (numNewMsgs) => {
                    console.log(`📬 ${numNewMsgs} new email(s) received`);
                    this.processNewEmails();
                });
            });

        } catch (error) {
            console.error('Email monitoring start error:', error);
        }
    }

    async processNewEmails() {
        try {
            // Fetch the latest unread emails
            this.imapClient.search(['UNSEEN'], (err, results) => {
                if (err || !results.length) return;

                const fetch = this.imapClient.fetch(results, { bodies: '' });

                fetch.on('message', (msg, seqno) => {
                    msg.on('body', (stream, info) => {
                        mailparser.simpleParser(stream, async (err, parsed) => {
                            if (err) {
                                console.error('Email parsing error:', err);
                                return;
                            }

                            await this.handleIncomingEmail(parsed);
                        });
                    });
                });
            });

        } catch (error) {
            console.error('New email processing error:', error);
        }
    }

    async handleIncomingEmail(emailData) {
        try {
            console.log(`📨 Processing email from: ${emailData.from.text}`);

            // Extract email details
            const emailContent = {
                from: emailData.from.text,
                to: emailData.to.text,
                subject: emailData.subject,
                body: emailData.text || emailData.html,
                messageId: emailData.messageId,
                date: emailData.date
            };

            // Check for auto-reply rules
            const shouldAutoReply = await this.checkAutoReplyRules(emailContent);
            
            if (shouldAutoReply.reply) {
                await this.sendAutoReply(emailContent, shouldAutoReply.agentId, shouldAutoReply.template);
            }

            // Log the incoming email
            await this.logIncomingEmail(emailContent);

        } catch (error) {
            console.error('Incoming email handling error:', error);
        }
    }

    async checkAutoReplyRules(emailContent) {
        try {
            // Get auto-reply rules for the recipient email
            const rules = await this.getActiveAutoReplyRules(emailContent.to);

            for (const rule of rules) {
                if (this.emailMatchesRule(emailContent, rule)) {
                    return {
                        reply: true,
                        agentId: rule.agent_id,
                        template: rule.response_template,
                        ruleId: rule.id
                    };
                }
            }

            return { reply: false };

        } catch (error) {
            console.error('Auto-reply rule check error:', error);
            return { reply: false };
        }
    }

    emailMatchesRule(emailContent, rule) {
        const subject = emailContent.subject.toLowerCase();
        const body = emailContent.body.toLowerCase();
        const sender = emailContent.from.toLowerCase();

        // Check keyword triggers
        if (rule.trigger_keywords && rule.trigger_keywords.length > 0) {
            const hasKeyword = rule.trigger_keywords.some(keyword => 
                subject.includes(keyword.toLowerCase()) || body.includes(keyword.toLowerCase())
            );
            if (!hasKeyword) return false;
        }

        // Check sender domain restrictions
        if (rule.sender_domains && rule.sender_domains.length > 0) {
            const senderDomain = sender.split('@')[1];
            const hasDomain = rule.sender_domains.some(domain => 
                senderDomain.includes(domain.toLowerCase())
            );
            if (!hasDomain) return false;
        }

        // Check subject patterns
        if (rule.subject_patterns && rule.subject_patterns.length > 0) {
            const hasPattern = rule.subject_patterns.some(pattern => {
                const regex = new RegExp(pattern, 'i');
                return regex.test(subject);
            });
            if (!hasPattern) return false;
        }

        return true;
    }

    async sendAutoReply(emailContent, agentId, template) {
        try {
            // Generate personalized auto-reply using agent
            const replyContent = await this.generateAutoReply(emailContent, agentId, template);

            const replyOptions = {
                to: emailContent.from,
                subject: `Re: ${emailContent.subject}`,
                body: replyContent,
                from_agent: agentId,
                source: 'auto_reply',
                in_reply_to: emailContent.messageId
            };

            await this.sendEmail(replyOptions);
            
            console.log(`✅ Auto-reply sent to ${emailContent.from} using ${agentId}`);

        } catch (error) {
            console.error('Auto-reply sending error:', error);
        }
    }

    async generateAutoReply(emailContent, agentId, template) {
        try {
            const prompt = `As ${this.getAgentName(agentId)}, generate a personalized auto-reply email based on:

Template: ${template}
Original Email:
From: ${emailContent.from}
Subject: ${emailContent.subject}
Content: ${emailContent.body.substring(0, 500)}...

Create a helpful, professional auto-reply that addresses their inquiry while using the template as a guide.
Make it sound natural and Nigerian-business appropriate.`;

            const response = await this.getAgentResponse(agentId, prompt);
            
            return response + `\n\n--\nThis is an automated response from ${this.getAgentName(agentId)}\nODIA AI - Nigeria's Voice AI Infrastructure Platform`;

        } catch (error) {
            console.error('Auto-reply generation error:', error);
            return template + "\n\n--\nThis is an automated response from ODIA AI";
        }
    }

    // ===========================================
    // AUTO-REPLY RULE MANAGEMENT
    // ===========================================

    async setupAutoReply(req, res) {
        try {
            const {
                userEmail,
                agentId,
                ruleName,
                triggerKeywords,
                senderDomains,
                subjectPatterns,
                responseTemplate
            } = req.body;

            const ruleId = await this.createAutoReplyRule({
                user_email: userEmail,
                agent_id: agentId,
                rule_name: ruleName,
                trigger_keywords: triggerKeywords,
                sender_domains: senderDomains,
                subject_patterns: subjectPatterns,
                response_template: responseTemplate,
                is_active: true
            });

            res.json({
                success: true,
                rule_id: ruleId,
                message: 'Auto-reply rule created successfully'
            });

        } catch (error) {
            console.error('Auto-reply setup error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // ===========================================
    // EMAIL TEMPLATES SYSTEM
    // ===========================================

    initializeEmailTemplates() {
        // Business email templates
        this.emailTemplates.set('business_inquiry', {
            subject: 'Thank you for your business inquiry',
            template: `Dear {{name}},

Thank you for reaching out to us regarding {{inquiry_type}}.

We appreciate your interest in ODIA AI's voice automation solutions for Nigerian businesses. Our team specializes in:

• WhatsApp Business Automation
• Voice AI for Customer Support  
• Payment Integration with Flutterwave
• Multi-language Support (English, Pidgin, Yoruba, Hausa, Igbo)

A member of our team will review your inquiry and respond within 24 hours with detailed information tailored to your business needs.

Best regards,
{{agent_name}}
ODIA AI Business Development Team`
        });

        this.emailTemplates.set('technical_support', {
            subject: 'Technical Support - We\'re Here to Help',
            template: `Hello {{name}},

We've received your technical support request regarding {{issue_type}}.

Our technical team is reviewing your case and will provide a solution within 4 hours during business hours (9 AM - 6 PM WAT).

In the meantime, you can:
• Check our documentation at docs.odia.dev
• Contact our WhatsApp support: +234-814-199-5397
• Access your dashboard at dashboard.odia.dev

Support Ticket ID: {{ticket_id}}

Best regards,
{{agent_name}}
ODIA AI Technical Support`
        });

        this.emailTemplates.set('payment_confirmation', {
            subject: 'Payment Confirmation - ODIA AI Services',
            template: `Dear {{customer_name}},

Thank you for your payment! We've successfully received your payment of ₦{{amount}} for {{service_description}}.

Payment Details:
• Transaction ID: {{transaction_id}}
• Amount: ₦{{amount}}
• Service: {{service_description}}
• Date: {{payment_date}}

Your ODIA AI services are now active. You can start using your AI agents immediately.

Access your dashboard: https://dashboard.odia.dev
Need help? WhatsApp us: +234-814-199-5397

Thank you for choosing ODIA AI!

Best regards,
{{agent_name}}
ODIA AI Billing Team`
        });
    }

    // ===========================================
    // UTILITY METHODS
    // ===========================================

    async getAgentResponse(agentId, prompt) {
        // Implementation would call Claude API with agent context
        // For now, returning a mock response
        return `[${this.getAgentName(agentId)} response to: ${prompt.substring(0, 50)}...]`;
    }

    getAgentName(agentId) {
        const agentNames = {
            'lexi-pro': 'Agent Lexi Pro',
            'atlas-corporate': 'Agent Atlas Corporate',
            'miss-legal': 'Agent Miss Legal',
            'paymaster': 'Agent PayMaster',
            'crossai-emergency': 'Agent CrossAI Emergency',
            'miss-academic': 'Agent MISS Academic',
            'tech-support': 'Agent TechSupport',
            'luxury-service': 'Agent LuxuryService',
            'med-assist': 'Agent MedAssist',
            'edu-kids': 'Agent EduKids',
            'gov-connect': 'Agent GovConnect'
        };
        
        return agentNames[agentId] || 'ODIA AI Assistant';
    }

    async sendWhatsAppConfirmation(phoneNumber, emailResult, recipient) {
        // Integration with WhatsApp API to send confirmation
        const message = `✅ Email sent successfully!
        
📧 To: ${recipient}
📨 Message ID: ${emailResult.messageId}
⏰ Sent: ${new Date().toLocaleString('en-NG')}

Your email has been delivered. The recipient should receive it within a few minutes.`;

        // Implementation would call WhatsApp API
        console.log(`WhatsApp confirmation to ${phoneNumber}: ${message}`);
    }

    // Database integration methods (implement with Supabase)
    async storeEmailLog(emailData) {
        // Store in email_automations table
        console.log('Storing email log:', emailData);
    }

    async logIncomingEmail(emailContent) {
        // Log incoming email for analytics
        console.log('Logging incoming email:', emailContent.from);
    }

    async createAutoReplyRule(ruleData) {
        // Store in email_auto_reply_rules table
        const ruleId = `rule_${Date.now()}`;
        console.log('Creating auto-reply rule:', ruleId);
        return ruleId;
    }

    async getActiveAutoReplyRules(userEmail) {
        // Query email_auto_reply_rules table
        // Return mock data for now
        return [
            {
                id: 'rule_1',
                agent_id: 'lexi-pro',
                trigger_keywords: ['quote', 'pricing', 'cost'],
                response_template: 'Thank you for your pricing inquiry. We will send you a detailed quote within 24 hours.'
            }
        ];
    }

    async logEmailInteraction(agentId, phoneNumber, emailData, emailResult) {
        // Log the WhatsApp to Email interaction
        console.log(`Email interaction logged: ${agentId} -> ${phoneNumber} -> ${emailData.recipient}`);
    }

    // Test email system
    async testEmailSystem(req, res) {
        try {
            const testEmail = {
                to: req.body.testEmail || 'test@example.com',
                subject: 'ODIA AI Email System Test',
                body: 'This is a test email from the ODIA AI email automation system. If you receive this, the system is working correctly!',
                from_agent: 'lexi-pro',
                source: 'test'
            };

            const result = await this.sendEmail(testEmail);
            
            res.json({
                success: true,
                test_result: result,
                message: 'Email system test completed successfully'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message,
                message: 'Email system test failed'
            });
        }
    }
}

// Initialize and export
const emailSystem = new EmailAutomationSystem();
module.exports = emailSystem;

// Usage Examples:
/*
1. WhatsApp to Email:
   User sends: "Send email to client@company.com about project update - The project is on track and will be completed by Friday"
   System automatically composes and sends professional email

2. Auto-Reply Setup:
   POST /api/setup-auto-reply
   {
     "userEmail": "support@mybusiness.com",
     "agentId": "lexi-pro", 
     "ruleName": "Pricing Inquiries",
     "triggerKeywords": ["price", "cost", "quote"],
     "responseTemplate": "Thank you for your pricing inquiry..."
   }

3. Email Monitoring:
   System automatically monitors inbox and sends AI-generated replies based on rules

4. Integration Commands:
   "email john@example.com: Please send the quarterly report"
   "compose email to team@company.com subject: Meeting Tomorrow body: Don't forget our 10 AM meeting"
   "send pricing email to prospect@business.com"
*/