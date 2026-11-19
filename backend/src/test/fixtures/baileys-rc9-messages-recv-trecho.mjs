// Trecho literal de baileys@7.0.0-rc.9, lib/Socket/messages-recv.js, linhas 1159 a 1225 (sha256 do arquivo inteiro
// 8b9329ddf95fa7a1785826d8861af236f5f055ff22a5ed1ce52afdf9565d873e). Copyright WhiskeySockets/Baileys, licença MIT.
// Embrulhado numa função para o teste ops/evolution-api (evolutionBaileysPatch.test.js) aplicar o patch e executar.
export const montar = ({ ws, ev, sendMessageAck, onUnexpectedError, handleMessage, handleCall, handleReceipt, handleNotification, handleBadAck }) => {
    /// processes a node with the given function
    /// and adds the task to the existing buffer if we're buffering events
    const processNodeWithBuffer = async (node, identifier, exec) => {
        ev.buffer();
        await execTask();
        ev.flush();
        function execTask() {
            return exec(node, false).catch(err => onUnexpectedError(err, identifier));
        }
    };
    const makeOfflineNodeProcessor = () => {
        const nodeProcessorMap = new Map([
            ['message', handleMessage],
            ['call', handleCall],
            ['receipt', handleReceipt],
            ['notification', handleNotification]
        ]);
        const nodes = [];
        let isProcessing = false;
        const enqueue = (type, node) => {
            nodes.push({ type, node });
            if (isProcessing) {
                return;
            }
            isProcessing = true;
            const promise = async () => {
                while (nodes.length && ws.isOpen) {
                    const { type, node } = nodes.shift();
                    const nodeProcessor = nodeProcessorMap.get(type);
                    if (!nodeProcessor) {
                        onUnexpectedError(new Error(`unknown offline node type: ${type}`), 'processing offline node');
                        continue;
                    }
                    await nodeProcessor(node);
                }
                isProcessing = false;
            };
            promise().catch(error => onUnexpectedError(error, 'processing offline nodes'));
        };
        return { enqueue };
    };
    const offlineNodeProcessor = makeOfflineNodeProcessor();
    const processNode = async (type, node, identifier, exec) => {
        const isOffline = !!node.attrs.offline;
        if (isOffline) {
            offlineNodeProcessor.enqueue(type, node);
        }
        else {
            await processNodeWithBuffer(node, identifier, exec);
        }
    };
    // recv a message
    ws.on('CB:message', async (node) => {
        await processNode('message', node, 'processing message', handleMessage);
    });
    ws.on('CB:call', async (node) => {
        await processNode('call', node, 'handling call', handleCall);
    });
    ws.on('CB:receipt', async (node) => {
        await processNode('receipt', node, 'handling receipt', handleReceipt);
    });
    ws.on('CB:notification', async (node) => {
        await processNode('notification', node, 'handling notification', handleNotification);
    });
    ws.on('CB:ack,class:message', (node) => {
        handleBadAck(node).catch(error => onUnexpectedError(error, 'handling bad ack'));
    });
    return { processNode };
};
