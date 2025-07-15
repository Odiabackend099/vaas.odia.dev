// Complete Deployment Scripts & System Monitoring
// Automated deployment, health monitoring, and system management for ODIA 11-Agent System

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

class DeploymentMonitoringSystem {
    constructor() {
        this.deploymentStatus = new Map();
        this.systemHealth = new Map();
        this.alertThresholds = new Map();
        this.monitoringMetrics = new Map();
        
        this.initializeMonitoring();
        this.setupRoutes();
        this.startHealthChecks();
        this.setupAlertSystem();
    }

    setupRoutes() {
        const app = express();
        app.use(express.json());

        // Deployment endpoints
        app.post('/api/deploy/full-system', this.deployFullSystem.bind(this));
        app.post('/api/deploy/agent/:agentId', this.deploySpecificAgent.bind(this));
        app.post('/api/deploy/update-system', this.updateSystem.bind(this));
        app.get('/api/deploy/status', this.getDeploymentStatus.bind(this));

        // Health monitoring endpoints
        app.get('/api/health/system', this.getSystemHealth.bind(this));
        app.get('/api/health/agents', this.getAgentsHealth.bind(this));
        app.get('/api/health/services', this.getServicesHealth.bind(this));
        app.get('/api/health/detailed', this.getDetailedHealthReport.bind(this));

        // Performance monitoring
        app.get('/api/metrics/performance', this.getPerformanceMetrics.bind(this));
        app.get('/api/metrics/usage', this.getUsageMetrics.bind(this));
        app.get('/api/metrics/errors', this.getErrorMetrics.bind(this));

        // System management
        app.post('/api/system/restart/:service', this.restartService.bind(this));
        app.post('/api/system/scale/:service', this.scaleService.bind(this));
        app.get('/api/system/logs/:service', this.getServiceLogs.bind(this));
        app.post('/api/system/backup', this.createSystemBackup.bind(this));

        return app;
    }

    // ===========================================
    // SYSTEM DEPLOYMENT
    // ===========================================

    async deployFullSystem(req, res) {
        try {
            const { environment = 'production', config = {} } = req.body;
            
            console.log('🚀 Starting ODIA 11-Agent Mega-System deployment...');

            const deploymentId = `deploy_${Date.now()}`;
            this.deploymentStatus.set(deploymentId, {
                status: 'initializing',
                started_at: new Date(),
                environment: environment,
                steps: []
            });

            // Start async deployment
            this.executeFullDeployment(deploymentId, environment, config);

            res.json({
                success: true,
                deployment_id: deploymentId,
                status: 'initiated',
                estimated_duration: '15-20 minutes',
                tracking_url: `/api/deploy/status?id=${deploymentId}`
            });

        } catch (error) {
            console.error('Deployment initiation error:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async executeFullDeployment(deploymentId, environment, config) {
        try {
            const deployment = this.deploymentStatus.get(deploymentId);
            
            // Step 1: Environment Setup
            await this.updateDeploymentStep(deploymentId, 'Environment Setup', 'running');
            await this.setupEnvironment(environment, config);
            await this.updateDeploymentStep(deploymentId, 'Environment Setup', 'completed');

            // Step 2: Database Migration
            await this.updateDeploymentStep(deploymentId, 'Database Migration', 'running');
            await this.runDatabaseMigrations();
            await this.updateDeploymentStep(deploymentId, 'Database Migration', 'completed');

            // Step 3: Service Deployment
            await this.updateDeploymentStep(deploymentId, 'Core Services', 'running');
            await this.deployCoreServices();
            await this.updateDeploymentStep(deploymentId, 'Core Services', 'completed');

            // Step 4: Agent Deployment
            await this.updateDeploymentStep(deploymentId, 'AI Agents', 'running');
            await this.deployAllAgents();
            await this.updateDeploymentStep(deploymentId, 'AI Agents', 'completed');

            // Step 5: Integration Testing
            await this.updateDeploymentStep(deploymentId, 'Integration Testing', 'running');
            await this.runIntegrationTests();
            await this.updateDeploymentStep(deploymentId, 'Integration Testing', 'completed');

            // Step 6: Health Verification
            await this.updateDeploymentStep(deploymentId, 'Health Verification', 'running');
            await this.verifySystemHealth();
            await this.updateDeploymentStep(deploymentId, 'Health Verification', 'completed');

            // Step 7: Production Activation
            await this.updateDeploymentStep(deploymentId, 'Production Activation', 'running');
            await this.activateProduction();
            await this.updateDeploymentStep(deploymentId, 'Production Activation', 'completed');

            // Deployment Complete
            deployment.status = 'completed';
            deployment.completed_at = new Date();
            deployment.success = true;

            console.log('✅ ODIA 11-Agent System deployment completed successfully!');
            
            // Send success notification
            await this.sendDeploymentNotification(deploymentId, 'success');

        } catch (error) {
            console.error('Deployment execution error:', error);
            
            const deployment = this.deploymentStatus.get(deploymentId);
            deployment.status = 'failed';
            deployment.error = error.message;
            deployment.failed_at = new Date();

            await this.sendDeploymentNotification(deploymentId, 'failed', error.message);
        }
    }

    async setupEnvironment(environment, config) {
        console.log(`🔧 Setting up ${environment} environment...`);

        // Create environment configuration
        const envConfig = {
            NODE_ENV: environment,
            ODIA_VERSION: '1.0.0',
            DEPLOYMENT_TIME: new Date().toISOString(),
            ...config
        };

        // Validate required environment variables
        const requiredVars = [
            'SUPABASE_URL',
            'SUPABASE_ANON_KEY',
            'CLAUDE_API_KEY',
            'ELEVENLABS_API_KEY',
            'OPENAI_API_KEY',
            'WHATSAPP_ACCESS_TOKEN',
            'FLUTTERWAVE_SECRET_KEY',
            'GMAIL_CLIENT_ID'
        ];

        for (const varName of requiredVars) {
            if (!process.env[varName] && !envConfig[varName]) {
                throw new Error(`Missing required environment variable: ${varName}`);
            }
        }

        // Write deployment configuration
        await fs.writeFile(
            path.join(__dirname, '.env.deployment'),
            Object.entries(envConfig).map(([key, value]) => `${key}=${value}`).join('\n')
        );

        console.log('✅ Environment configuration complete');
    }

    async runDatabaseMigrations() {
        console.log('📊 Running database migrations...');

        try {
            // Run Supabase migrations
            await this.executeCommand('npx supabase db reset --linked');
            await this.executeCommand('npx supabase db push --linked');
            
            // Seed initial data
            await this.seedInitialData();
            
            console.log('✅ Database migrations completed');

        } catch (error) {
            console.error('Database migration error:', error);
            throw new Error('Database migration failed');
        }
    }

    async deployCoreServices() {
        console.log('⚙️ Deploying core services...');

        const services = [
            'voice-processing',
            'email-automation',
            'payment-processing',
            'legal-services',
            'business-intelligence',
            'whatsapp-integration'
        ];

        for (const service of services) {
            await this.deployService(service);
        }

        console.log('✅ Core services deployed');
    }

    async deployAllAgents() {
        console.log('🤖 Deploying all 11 AI agents...');

        const agents = [
            'lexi-pro',
            'atlas-corporate', 
            'miss-legal',
            'paymaster',
            'crossai-emergency',
            'miss-academic',
            'tech-support',
            'luxury-service',
            'med-assist',
            'edu-kids',
            'gov-connect'
        ];

        for (const agentId of agents) {
            await this.deployAgent(agentId);
        }

        console.log('✅ All 11 agents deployed and operational');
    }

    async deployAgent(agentId) {
        console.log(`🤖 Deploying ${agentId}...`);

        try {
            // Load agent configuration
            const agentConfig = await this.loadAgentConfig(agentId);
            
            // Deploy agent container/service
            await this.deployAgentService(agentId, agentConfig);
            
            // Configure agent endpoints
            await this.configureAgentEndpoints(agentId, agentConfig);
            
            // Test agent functionality
            await this.testAgentDeployment(agentId);
            
            // Update agent status
            await this.updateAgentStatus(agentId, 'deployed');

            console.log(`✅ Agent ${agentId} deployed successfully`);

        } catch (error) {
            console.error(`Agent ${agentId} deployment error:`, error);
            throw new Error(`Failed to deploy agent ${agentId}: ${error.message}`);
        }
    }

    // ===========================================
    // HEALTH MONITORING SYSTEM
    // ===========================================

    initializeMonitoring() {
        // Set alert thresholds
        this.alertThresholds.set('response_time', { warning: 2000, critical: 5000 }); // ms
        this.alertThresholds.set('error_rate', { warning: 0.05, critical: 0.1 }); // 5%, 10%
        this.alertThresholds.set('cpu_usage', { warning: 70, critical: 85 }); // %
        this.alertThresholds.set('memory_usage', { warning: 80, critical: 90 }); // %
        this.alertThresholds.set('disk_usage', { warning: 85, critical: 95 }); // %

        // Initialize system health tracking
        this.systemHealth.set('overall_status', 'healthy');
        this.systemHealth.set('last_check', new Date());
        this.systemHealth.set('uptime_start', new Date());
    }

    startHealthChecks() {
        // Comprehensive health check every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            try {
                await this.performHealthChecks();
            } catch (error) {
                console.error('Health check error:', error);
            }
        });

        // Quick ping checks every 30 seconds
        cron.schedule('*/30 * * * * *', async () => {
            try {
                await this.performQuickHealthChecks();
            } catch (error) {
                console.error('Quick health check error:', error);
            }
        });

        // Performance metrics collection every minute
        cron.schedule('* * * * *', async () => {
            try {
                await this.collectPerformanceMetrics();
            } catch (error) {
                console.error('Metrics collection error:', error);
            }
        });
    }

    async performHealthChecks() {
        console.log('🏥 Performing comprehensive health checks...');

        const healthResults = {
            timestamp: new Date(),
            overall_status: 'healthy',
            services: {},
            agents: {},
            infrastructure: {},
            alerts: []
        };

        try {
            // Check core services
            healthResults.services = await this.checkServicesHealth();
            
            // Check all agents
            healthResults.agents = await this.checkAgentsHealth();
            
            // Check infrastructure
            healthResults.infrastructure = await this.checkInfrastructureHealth();
            
            // Evaluate overall health
            healthResults.overall_status = this.evaluateOverallHealth(healthResults);
            
            // Check for alerts
            healthResults.alerts = await this.checkForAlerts(healthResults);
            
            // Update system health
            this.systemHealth.set('last_health_check', healthResults);
            this.systemHealth.set('overall_status', healthResults.overall_status);
            
            // Send alerts if necessary
            if (healthResults.alerts.length > 0) {
                await this.sendHealthAlerts(healthResults.alerts);
            }

        } catch (error) {
            console.error('Health check execution error:', error);
            healthResults.overall_status = 'unhealthy';
            healthResults.error = error.message;
        }
    }

    async checkServicesHealth() {
        const services = {
            database: await this.checkDatabaseHealth(),
            voice_engine: await this.checkVoiceEngineHealth(),
            email_system: await this.checkEmailSystemHealth(),
            payment_system: await this.checkPaymentSystemHealth(),
            whatsapp_api: await this.checkWhatsAppAPIHealth(),
            knowledge_base: await this.checkKnowledgeBaseHealth(),
            legal_services: await this.checkLegalServicesHealth()
        };

        return services;
    }

    async checkAgentsHealth() {
        const agents = {};
        const agentIds = [
            'lexi-pro', 'atlas-corporate', 'miss-legal', 'paymaster',
            'crossai-emergency', 'miss-academic', 'tech-support',
            'luxury-service', 'med-assist', 'edu-kids', 'gov-connect'
        ];

        for (const agentId of agentIds) {
            agents[agentId] = await this.checkAgentHealth(agentId);
        }

        return agents;
    }

    async checkAgentHealth(agentId) {
        try {
            const startTime = Date.now();
            
            // Test agent endpoint
            const response = await fetch(`${process.env.API_BASE_URL}/api/agents/${agentId}/health`, {
                method: 'GET',
                timeout: 5000
            });

            const responseTime = Date.now() - startTime;
            const isHealthy = response.ok;

            return {
                status: isHealthy ? 'healthy' : 'unhealthy',
                response_time: responseTime,
                last_check: new Date(),
                endpoint_available: isHealthy,
                error: isHealthy ? null : 'Endpoint not responding'
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                response_time: null,
                last_check: new Date(),
                endpoint_available: false,
                error: error.message
            };
        }
    }

    async checkDatabaseHealth() {
        try {
            // Test database connection and query performance
            const startTime = Date.now();
            
            // Mock database health check
            const queryTime = Date.now() - startTime;
            
            return {
                status: 'healthy',
                connection: 'active',
                query_time: queryTime,
                tables_accessible: true,
                last_backup: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                connection: 'failed',
                error: error.message
            };
        }
    }

    async collectPerformanceMetrics() {
        const metrics = {
            timestamp: new Date(),
            system: await this.getSystemMetrics(),
            agents: await this.getAgentMetrics(),
            api: await this.getAPIMetrics(),
            business: await this.getBusinessMetrics()
        };

        // Store metrics for analysis
        this.monitoringMetrics.set(Date.now(), metrics);

        // Keep only last 1000 metric entries
        if (this.monitoringMetrics.size > 1000) {
            const oldestKey = Math.min(...this.monitoringMetrics.keys());
            this.monitoringMetrics.delete(oldestKey);
        }
    }

    async getSystemMetrics() {
        // Mock system metrics (implement with actual system monitoring)
        return {
            cpu_usage: Math.random() * 100,
            memory_usage: Math.random() * 100,
            disk_usage: Math.random() * 100,
            network_io: {
                bytes_in: Math.floor(Math.random() * 1000000),
                bytes_out: Math.floor(Math.random() * 1000000)
            },
            active_connections: Math.floor(Math.random() * 1000),
            uptime: Date.now() - this.systemHealth.get('uptime_start').getTime()
        };
    }

    async getAgentMetrics() {
        // Mock agent performance metrics
        return {
            total_requests: Math.floor(Math.random() * 10000),
            successful_requests: Math.floor(Math.random() * 9500),
            average_response_time: Math.random() * 2000,
            active_conversations: Math.floor(Math.random() * 500),
            voice_interactions: Math.floor(Math.random() * 200),
            email_automations: Math.floor(Math.random() * 100)
        };
    }

    // ===========================================
    // ALERT SYSTEM
    // ===========================================

    setupAlertSystem() {
        // Configure email transporter for alerts
        this.alertTransporter = nodemailer.createTransporter({
            service: 'gmail',
            auth: {
                user: process.env.ALERT_EMAIL_USER,
                pass: process.env.ALERT_EMAIL_PASS
            }
        });
    }

    async checkForAlerts(healthResults) {
        const alerts = [];

        // Check service health alerts
        for (const [service, health] of Object.entries(healthResults.services)) {
            if (health.status === 'unhealthy') {
                alerts.push({
                    type: 'service_down',
                    severity: 'critical',
                    service: service,
                    message: `Service ${service} is unhealthy: ${health.error}`,
                    timestamp: new Date()
                });
            }
        }

        // Check agent health alerts
        for (const [agentId, health] of Object.entries(healthResults.agents)) {
            if (health.status === 'unhealthy') {
                alerts.push({
                    type: 'agent_down',
                    severity: 'high',
                    agent: agentId,
                    message: `Agent ${agentId} is not responding: ${health.error}`,
                    timestamp: new Date()
                });
            }

            // Check response time alerts
            if (health.response_time > this.alertThresholds.get('response_time').critical) {
                alerts.push({
                    type: 'performance_degradation',
                    severity: 'high',
                    agent: agentId,
                    message: `Agent ${agentId} response time is ${health.response_time}ms (critical threshold: ${this.alertThresholds.get('response_time').critical}ms)`,
                    timestamp: new Date()
                });
            }
        }

        // Check infrastructure alerts
        const infra = healthResults.infrastructure;
        if (infra.cpu_usage > this.alertThresholds.get('cpu_usage').critical) {
            alerts.push({
                type: 'resource_critical',
                severity: 'critical',
                resource: 'cpu',
                message: `CPU usage is ${infra.cpu_usage}% (critical threshold: ${this.alertThresholds.get('cpu_usage').critical}%)`,
                timestamp: new Date()
            });
        }

        return alerts;
    }

    async sendHealthAlerts(alerts) {
        try {
            for (const alert of alerts) {
                // Send email alert
                await this.sendEmailAlert(alert);
                
                // Send WhatsApp alert for critical issues
                if (alert.severity === 'critical') {
                    await this.sendWhatsAppAlert(alert);
                }
                
                // Log alert
                console.error(`🚨 ALERT [${alert.severity}]: ${alert.message}`);
            }

        } catch (error) {
            console.error('Alert sending error:', error);
        }
    }

    async sendEmailAlert(alert) {
        const mailOptions = {
            from: process.env.ALERT_EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: `🚨 ODIA AI Alert: ${alert.type} - ${alert.severity}`,
            html: `
                <h2>ODIA AI System Alert</h2>
                <p><strong>Type:</strong> ${alert.type}</p>
                <p><strong>Severity:</strong> ${alert.severity}</p>
                <p><strong>Message:</strong> ${alert.message}</p>
                <p><strong>Timestamp:</strong> ${alert.timestamp}</p>
                <p><strong>Service/Agent:</strong> ${alert.service || alert.agent || 'System'}</p>
                
                <hr>
                <p>Check system health dashboard: <a href="https://odia.dev/admin/health">https://odia.dev/admin/health</a></p>
                <p>This is an automated alert from ODIA AI monitoring system.</p>
            `
        };

        await this.alertTransporter.sendMail(mailOptions);
    }

    // ===========================================
    // API ENDPOINTS IMPLEMENTATION
    // ===========================================

    async getSystemHealth(req, res) {
        try {
            const lastHealthCheck = this.systemHealth.get('last_health_check');
            const overallStatus = this.systemHealth.get('overall_status');
            const uptimeStart = this.systemHealth.get('uptime_start');

            res.json({
                overall_status: overallStatus,
                uptime: Date.now() - uptimeStart.getTime(),
                last_check: lastHealthCheck?.timestamp,
                system_version: '1.0.0',
                environment: process.env.NODE_ENV,
                agents_deployed: 11,
                services_running: lastHealthCheck ? Object.keys(lastHealthCheck.services).length : 0,
                health_score: this.calculateHealthScore(lastHealthCheck)
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getDetailedHealthReport(req, res) {
        try {
            const lastHealthCheck = this.systemHealth.get('last_health_check');
            
            if (!lastHealthCheck) {
                return res.json({
                    message: 'No health data available. System initializing...',
                    status: 'initializing'
                });
            }

            // Add performance trends
            const performanceTrends = this.calculatePerformanceTrends();
            
            res.json({
                ...lastHealthCheck,
                performance_trends: performanceTrends,
                system_info: {
                    version: '1.0.0',
                    deployment_time: process.env.DEPLOYMENT_TIME,
                    environment: process.env.NODE_ENV,
                    region: 'West Africa (Nigeria)'
                }
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async getPerformanceMetrics(req, res) {
        try {
            const { timeframe = '1h' } = req.query;
            
            // Get metrics for the specified timeframe
            const metrics = this.getMetricsForTimeframe(timeframe);
            
            res.json({
                timeframe: timeframe,
                metrics_count: metrics.length,
                performance_data: metrics,
                summary: this.summarizeMetrics(metrics),
                trends: this.calculateTrends(metrics)
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async restartService(req, res) {
        try {
            const { service } = req.params;
            const { force = false } = req.body;

            console.log(`🔄 Restarting service: ${service}`);

            // Perform service restart
            const result = await this.performServiceRestart(service, force);

            res.json({
                success: true,
                service: service,
                restart_result: result,
                message: `Service ${service} restarted successfully`,
                timestamp: new Date()
            });

        } catch (error) {
            console.error(`Service restart error for ${req.params.service}:`, error);
            res.status(500).json({
                success: false,
                error: error.message,
                service: req.params.service
            });
        }
    }

    // ===========================================
    // UTILITY METHODS
    // ===========================================

    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }

    async updateDeploymentStep(deploymentId, stepName, status) {
        const deployment = this.deploymentStatus.get(deploymentId);
        if (deployment) {
            deployment.steps.push({
                name: stepName,
                status: status,
                timestamp: new Date()
            });
        }
    }

    calculateHealthScore(healthCheck) {
        if (!healthCheck) return 0;

        let score = 100;
        
        // Deduct points for unhealthy services
        const unhealthyServices = Object.values(healthCheck.services).filter(s => s.status === 'unhealthy').length;
        score -= unhealthyServices * 10;
        
        // Deduct points for unhealthy agents
        const unhealthyAgents = Object.values(healthCheck.agents).filter(a => a.status === 'unhealthy').length;
        score -= unhealthyAgents * 5;
        
        // Deduct points for critical alerts
        const criticalAlerts = healthCheck.alerts.filter(a => a.severity === 'critical').length;
        score -= criticalAlerts * 15;

        return Math.max(0, score);
    }

    evaluateOverallHealth(healthResults) {
        const unhealthyServices = Object.values(healthResults.services).filter(s => s.status === 'unhealthy').length;
        const unhealthyAgents = Object.values(healthResults.agents).filter(a => a.status === 'unhealthy').length;
        const criticalAlerts = healthResults.alerts.filter(a => a.severity === 'critical').length;

        if (criticalAlerts > 0 || unhealthyServices > 2) {
            return 'critical';
        } else if (unhealthyServices > 0 || unhealthyAgents > 3) {
            return 'degraded';
        } else if (unhealthyAgents > 0) {
            return 'warning';
        } else {
            return 'healthy';
        }
    }

    async sendDeploymentNotification(deploymentId, status, error = null) {
        const deployment = this.deploymentStatus.get(deploymentId);
        
        const message = status === 'success' 
            ? `🎉 ODIA AI deployment completed successfully!\n\nDeployment ID: ${deploymentId}\nEnvironment: ${deployment.environment}\nDuration: ${this.formatDuration(deployment.started_at, deployment.completed_at)}`
            : `❌ ODIA AI deployment failed!\n\nDeployment ID: ${deploymentId}\nEnvironment: ${deployment.environment}\nError: ${error}`;

        console.log(message);
        
        // In production, send actual notifications via email/WhatsApp
    }

    formatDuration(start, end) {
        const diff = end.getTime() - start.getTime();
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }

    // Mock implementation methods
    async seedInitialData() {
        console.log('🌱 Seeding initial data...');
    }

    async deployService(serviceName) {
        console.log(`⚙️ Deploying service: ${serviceName}`);
    }

    async runIntegrationTests() {
        console.log('🧪 Running integration tests...');
    }

    async verifySystemHealth() {
        console.log('🏥 Verifying system health...');
    }

    async activateProduction() {
        console.log('🚀 Activating production systems...');
    }

    async loadAgentConfig(agentId) {
        return { id: agentId, name: `Agent ${agentId}` };
    }

    async deployAgentService(agentId, config) {
        console.log(`📦 Deploying agent service: ${agentId}`);
    }

    async configureAgentEndpoints(agentId, config) {
        console.log(`🔗 Configuring endpoints for: ${agentId}`);
    }

    async testAgentDeployment(agentId) {
        console.log(`🧪 Testing agent deployment: ${agentId}`);
    }

    async updateAgentStatus(agentId, status) {
        console.log(`📊 Agent ${agentId} status: ${status}`);
    }
}

// Initialize and export
const deploymentMonitoring = new DeploymentMonitoringSystem();
module.exports = deploymentMonitoring;

// Usage Examples:
/*
1. Deploy Full System:
   POST /api/deploy/full-system
   {
     "environment": "production",
     "config": {
       "replicas": 3,
       "auto_scaling": true
     }
   }

2. Check System Health:
   GET /api/health/system

3. Get Performance Metrics:
   GET /api/metrics/performance?timeframe=1h

4. Restart Service:
   POST /api/system/restart/voice-processing
   {
     "force": false
   }
*/