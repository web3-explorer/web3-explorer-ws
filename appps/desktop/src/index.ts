import { app, BrowserWindow, powerMonitor } from 'electron';
import log from 'electron-log/main';
import { updateElectronApp } from 'update-electron-app';
import { MainWindow } from './electron/mainWindow';

import { WebSocketServerWrapper } from './electron/ws-server/server';
import {setDefaultProtocolClient, setProtocolHandlerOSX, setProtocolHandlerWindowsLinux} from "./electron/protocol";


const wsServer = new WebSocketServerWrapper();

app.setName('Web3 Explorer ws');

log.initialize({ preload: true });
log.info('Application start-up');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

const onUnLock = () => {
    log.info('unlock-screen');
};

if (process.platform != 'linux') {
    powerMonitor.on('unlock-screen', onUnLock);
}

app.on('ready', async () => {
    await wsServer.start();
});


app.on('before-quit', async e => {
    e.preventDefault();
    await wsServer.stop();
    if (process.platform != 'linux') {
        powerMonitor.off('unlock-screen', onUnLock);
    }
    app.exit();
});


setDefaultProtocolClient();

switch (process.platform) {
    case 'darwin':
        setProtocolHandlerOSX();
        break;
    case 'linux':
    case 'win32':
        setProtocolHandlerWindowsLinux();
        break;
    default:
        throw new Error('Process platform is undefined');
}



app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        MainWindow.openMainWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

updateElectronApp({ logger: log });

