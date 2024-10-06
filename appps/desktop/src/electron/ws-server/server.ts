import WebSocket, { WebSocketServer } from 'ws';
import os from 'os';

export function getLocalIPAddress() {
    const networkInterfaces = os.networkInterfaces();

    // Loop through all network interfaces to find the Ethernet (or active network)
    for (const interfaceName of Object.keys(networkInterfaces)) {
        const addresses = networkInterfaces[interfaceName];

        if (addresses) {
            for (const addressInfo of addresses) {
                // Filter out internal addresses (loopback) and look for IPv4
                if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
                    console.log(
                        `Found IP address: ${addressInfo.address} for interface: ${interfaceName}`
                    );
                    return { adr: addressInfo.address, interfaceName: interfaceName };
                }
            }
        }
    }

    return null;
}

export enum WsCloseCode {
    WS_CLOSE_STOP_RECONNECT = 3001,
    WS_CLOSE_RECONNECT = 3002
}

export enum ErrCodes {
    DEVICE_NOT_EXISTS = 'DEVICE_NOT_EXISTS',
    PASSWORD_NOT_VALID = 'PASSWORD_NOT_VALID',
    SCREEN_IMAGE_NOT_EXISTS = 'SCREEN_IMAGE_NOT_EXISTS',
    SCREEN_IMAGE_NOT_UPDATE = 'SCREEN_IMAGE_NOT_UPDATE',
    EVENT_NOT_UPDATE = 'EVENT_NOT_UPDATE'
}

export interface Device {
    deviceId: string;
    password: string;
    platform: 'WEB' | 'ADR';
}

export interface User {
    id: string;
    metadata: {
        userAgent: string;
    };
    date: number;
    ws: WebSocket;
    device?: Device;
    client?: Device;
    manager?: {};
}

export const isWs_OPEN = (ws?: WebSocket) => {
    return ws && ws.readyState === WebSocket.OPEN;
};

export const isWs_CLOSED = (ws?: WebSocket) => {
    return ws && ws.readyState === WebSocket.CLOSED;
};

export const isWs_CONNECTING = (ws?: WebSocket) => {
    return ws && ws.readyState === WebSocket.CONNECTING;
};

function closeWs(ws: WebSocket, code?: number, reason?: string) {
    if (ws && isWs_OPEN(ws)) {
        ws.close(code, reason);
    }
}

const sendMessage = (message: any, ws: WebSocket) => {
    if (isWs_OPEN(ws)) {
        if (typeof message === 'string') {
            ws.send(message);
        } else {
            ws.send(JSON.stringify(message));
        }
    } else {
        console.error('ws is not open');
    }
};

function checkUser(users: Map<any, User>, ws: WebSocket, deviceId: string, password: string) {
    let deviceUser: User | null = null;
    users.forEach((user, _) => {
        if (user.device && user.device.deviceId === deviceId) {
            deviceUser = user;
        }
    });
    if (!deviceUser) {
        sendMessage(
            {
                action: 'loginError',
                errCode: ErrCodes.DEVICE_NOT_EXISTS
            },
            ws
        );
        return null;
    } else {
        if (deviceUser.device.password !== password) {
            sendMessage(
                {
                    action: 'loginError',
                    errCode: ErrCodes.PASSWORD_NOT_VALID
                },
                ws
            );
            return null;
        } else {
            return deviceUser;
        }
    }
}

function getMetaData(userAgent?: string, request?: any) {
    return {
        userAgent
    };
}

export class WebSocketServerWrapper {
    private users: Map<string, User>;
    private wss: WebSocketServer | undefined;
    private port: number;

    constructor(port: number = 6788) {
        this.port = port;
        this.users = new Map();
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.wss) {
                console.error('WebSocket server is already running.');
                reject(new Error('WebSocket server is already running.'));
                return;
            }

            this.wss = new WebSocketServer({ host: '0.0.0.0', port: this.port }, () => {
                console.log(`WebSocket server started on ws://0.0.0.0:${this.port}`);
                resolve();
            });

            this.wss.on('connection', async (ws: WebSocket, req: any) => {
                const userAgent = req.headers['user-agent'];
                const metadata = getMetaData(userAgent);
                console.log('New client connected');
                await this.handleWebSocketSession(ws, metadata);
            });

            this.wss.on('error', (error: Error) => {
                console.error('WebSocket server error:', error);
                reject(error);
            });
        });
    }

    // Stop the WebSocket server
    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.wss) {
                console.error('WebSocket server is not running.');
                reject(new Error('WebSocket server is not running.'));
                return;
            }

            // Close all client connections
            this.wss.clients.forEach((client: WebSocket) => {
                client.close();
            });

            // Close the WebSocket server
            this.wss.close(() => {
                console.log('WebSocket server stopped');
                this.wss = undefined;
                resolve();
            });
        });
    }

    async handleWebSocketSession(ws: WebSocket, metadata?: any) {
        const userId = crypto.randomUUID();
        console.log('connected', userId);
        this.users.set(userId, {
            id: userId,
            metadata,
            date: +new Date(),
            ws: ws,
            device: null,
            client: null
        });

        ws.addEventListener('message', async msg => {
            try {
                this.users.forEach((user_, _) => {
                    if (isWs_CLOSED(user_.ws)) {
                        closeWs(
                            user_.ws,
                            WsCloseCode.WS_CLOSE_STOP_RECONNECT,
                            'WS_CLOSE_STOP_RECONNECT'
                        );
                    }
                });
                const message = msg.data;
                if (typeof message === 'string' && message.startsWith('{')) {
                    const data = JSON.parse(message);
                    if (data.action === 'registerManager') {
                        this.users.forEach((user_, _) => {
                            if (user_.manager) {
                                closeWs(user_.ws);
                            }
                        });
                        this.users.set(userId, {
                            ...this.users.get(userId),
                            manager: {}
                        });
                        sendMessage(
                            {
                                action: 'logged'
                            },
                            ws
                        );

                        return;
                    }
                    if (data.action === 'registerDevice') {
                        const { deviceId, platform, password } = data.payload;
                        this.users.forEach((user_, userId_) => {
                            if (
                                user_.device &&
                                user_.device.deviceId === deviceId &&
                                userId_ !== userId
                            ) {
                                closeWs(user_.ws, WsCloseCode.WS_CLOSE_STOP_RECONNECT);
                            }
                        });
                        this.users.set(userId, {
                            ...this.users.get(userId),
                            device: { deviceId, password, platform }
                        });
                        sendMessage(
                            {
                                action: 'logged'
                            },
                            ws
                        );
                        return;
                    }

                    if (data.action === 'getClients') {
                        const clients: any[] = [];
                        this.users.forEach((user_, userId) => {
                            clients.push({
                                id: userId,
                                metadata: user_.metadata,
                                device: user_.device,
                                client: user_.client,
                                manager: user_.manager
                            });
                        });
                        sendMessage(
                            {
                                action: 'getClients',
                                payload: {
                                    clients
                                }
                            },
                            ws
                        );
                        return;
                    }
                    if (data.action === 'registerClient') {
                        const { deviceId, password, platform } = data.payload;
                        if (checkUser(this.users, ws, deviceId, password)) {
                            this.users.set(userId, {
                                ...this.users.get(userId),
                                client: { deviceId, platform, password }
                            });
                            sendMessage(
                                {
                                    action: 'logged',
                                    payload: {}
                                },
                                ws
                            );
                            return;
                        }
                    }
                    if (data.action === 'close') {
                        closeWs(ws, data.payload.code, data.payload.reason);
                    }
                    if (data.action === 'clientMsg') {
                        const user = this.users.get(userId);
                        console.log('on clientMsg', message);

                        if (!user.client) {
                            sendMessage(
                                {
                                    action: 'loginError',
                                    errCode: ErrCodes.DEVICE_NOT_EXISTS
                                },
                                ws
                            );
                            return;
                        }
                        const { deviceId, password } = user.client;
                        const deviceUser = checkUser(this.users, ws, deviceId, password);
                        if (deviceUser) {
                            sendMessage(message, deviceUser.ws);
                        }
                        return;
                    }
                    if (data.action === 'deviceMsg') {
                        const user = this.users.get(userId);
                        if (!user.device) {
                            sendMessage(
                                {
                                    action: 'loginError',
                                    errCode: ErrCodes.DEVICE_NOT_EXISTS
                                },
                                ws
                            );
                            return;
                        }
                        this.users.forEach((user_, _) => {
                            if (user_.client && user_.client.deviceId === user.device.deviceId) {
                                try {
                                    sendMessage(message, user_.ws);
                                } catch (e) {
                                    console.error(e, user_.ws);
                                }
                            }
                        });
                        return;
                    }
                }
            } catch (err: any) {
                console.log(err);
            }
        });

        let closeOrErrorHandler = () => {
            const user = this.users.get(userId);
            console.log('closeOrErrorHandler');
            if (user.device) {
                console.log('device close', user.device);
                this.users.forEach((user_, _) => {
                    if (user_.client && user_.client.deviceId === user.device.deviceId) {
                        console.log('sendClose', user_.client);
                        closeWs(
                            user_.ws,
                            WsCloseCode.WS_CLOSE_STOP_RECONNECT,
                            ErrCodes.DEVICE_NOT_EXISTS
                        );
                    }
                });
            }
            if (user.client && user.client.deviceId) {
                console.log('client close', user.client);
                const { deviceId } = user.client;

                let device: User;
                let count = 0;
                this.users.forEach((user_, userId_) => {
                    if (user_.device && user_.device.deviceId === deviceId) {
                        device = user_;
                    }
                    if (user_.client && user_.client.deviceId === deviceId && userId_ !== userId) {
                        count += 1;
                    }
                });
                console.log('client close client count', count);
                if (count === 0 && device) {
                    sendMessage(
                        {
                            action: 'clientMsg',
                            payload: {
                                eventType: 'stopPushingImage'
                            }
                        },
                        device.ws
                    );
                }
            }
            this.users.delete(userId);
        };
        ws.addEventListener('close', closeOrErrorHandler);
        ws.addEventListener('error', closeOrErrorHandler);
    }
}
