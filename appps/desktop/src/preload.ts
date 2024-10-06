import contextBridge = Electron.contextBridge;

contextBridge.exposeInMainWorld('backgroundApi', {
    platform: () => process.platform,
});
