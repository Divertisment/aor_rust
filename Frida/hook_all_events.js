// hook_all_events.js
// Hooks ALL known event dispatch methods simultaneously
// sudo frida -n "Albion-Online" -l hook_all_events.js -q -t 120

// Initialize il2cpp bridge so .class works on pointers
try {
    Il2Cpp.perform(function() {
        console.log('[+] il2cpp bridge ready');
    });
} catch (e) {
    console.log('[!] il2cpp bridge not available: ' + e.message);
}

var modules = Process.enumerateModules();
var gameBase = null;

for (var i = 0; i < modules.length; i++) {
    if (modules[i].name === "GameAssembly.so") {
        gameBase = modules[i].base;
        console.log("[+] GameAssembly.so base: " + gameBase);
    }
}

if (!gameBase) {
    console.log("[!] GameAssembly.so not found");
} else {
    // Hook ck1.af (handler registration) - RVA 0x1BBAB10
    var regAddr = gameBase.add(0x1BBAB10);
    console.log("[+] Hooking ck1.af at: " + regAddr);
    Interceptor.attach(regAddr, {
        onEnter: function(args) {
            var eventCode = args[1].toInt32();
            console.log("[ck1.af] eventCode=" + eventCode + " handler=" + args[2]);
        }
    });

    // Hook cr0.ael (OnEvent for game simulation) - RVA 0x19E8E88
    var aelAddr = gameBase.add(0x19E8E88);
    console.log("[+] Hooking cr0.ael at: " + aelAddr);
    Interceptor.attach(aelAddr, {
        onEnter: function(args) {
            console.log("[cr0.ael CALLED]");
            console.log("  event: " + args[1] + " code: " + args[2].toInt32());
        }
    });

    // Hook LoginClient.OnEvent - RVA 0x27C55E4
    var loginEvAddr = gameBase.add(0x27C55E4);
    console.log("[+] Hooking LoginClient.OnEvent at: " + loginEvAddr);
    Interceptor.attach(loginEvAddr, {
        onEnter: function(args) {
            console.log("[LoginClient.OnEvent] code=" + args[2].toInt32());
        }
    });

    // Hook cr0.ahx (OnOperationResponse for game simulation) - RVA 0x19E9228
    // args[0]=this(cr0), args[1]=gyx(OperationResponse), args[2]=opCode(short)
    var ahxAddr = gameBase.add(0x19E9228);
    console.log("[+] Hooking cr0.ahx at: " + ahxAddr);
    Interceptor.attach(ahxAddr, {
        onEnter: function(args) {
            var opCode = args[2].toInt32();
            if (opCode === 41) {  // ChangeCluster
                console.log("\n[ChangeCluster] opCode=" + opCode + "  extracting param[3]...");
                try {
                    var gyi = args[1];  // OperationResponse object
                    // Read the Dictionary<byte,object> Parameters via il2cpp field access
                    var pField = gyi.class.field('Parameters');
                    if (!pField) { console.log('  [!] no Parameters field'); return; }
                    var paramsDict = pField.readValue(gyi);
                    if (!paramsDict) { console.log('  [!] Parameters is null'); return; }

                    var entriesField = paramsDict.class.field('_entries');
                    var countField = paramsDict.class.field('_count');
                    if (!entriesField || !countField) { console.log('  [!] _entries/_count not found'); return; }

                    var arr = entriesField.readValue(paramsDict);
                    var total = countField.readValue(paramsDict).toInt32();

                    for (var i = 0; i < total; i++) {
                        var ent = arr.get(i);
                        if (!ent) continue;
                        var k = ent.field('key').readValue(ent).toInt32();
                        if (k !== 3) continue;

                        var v = ent.field('value').readValue(ent);
                        if (!v || !v.class) continue;
                        var vname = v.class.name || '';
                        if (vname !== 'Byte[]') { console.log('  [!] param[3] is ' + vname + ' not Byte[]'); break; }

                        var len = -1;
                        try { len = v.length; } catch (e) {
                            var lf = v.class.field('_length') || v.class.field('Length');
                            if (lf) len = lf.readValue(v).toInt32();
                        }
                        console.log('   param[3] Byte[] len=' + len);

                        // Write to file
                        var outPath = "/mnt/hgfs/D/AOR_win_mem/cluster_data.bin";
                        var buf = Memory.alloc(len);
                        for (var bi = 0; bi < len; bi++) {
                            buf.writeU8(v.get(bi).toInt32() & 0xff, bi);
                        }
                        var f = new File(outPath, 'wb');
                        f.write(buf.readByteArray(len));
                        f.flush();
                        f.close();
                        console.log('   wrote ' + len + ' bytes to ' + outPath);
                        break;
                    }
                } catch (e) {
                    console.log('  [!] error: ' + e.message);
                }
            } else {
                console.log("[cr0.ahx CALLED] opCode=" + opCode);
            }
        }
    });

    // Also hook cqy.ael - RVA 0x19EA0E4
    var cqyAelAddr = gameBase.add(0x19EA0E4);
    console.log("[+] Hooking cqy.ael at: " + cqyAelAddr);
    Interceptor.attach(cqyAelAddr, {
        onEnter: function(args) {
            console.log("[cqy.ael CALLED] code=" + args[2].toInt32());
        }
    });

    // Hook GameObject::GetName for names
    var uBase = null;
    for (var j = 0; j < modules.length; j++) {
        if (modules[j].name === "UnityPlayer.so") {
            uBase = modules[j].base;
            break;
        }
    }
    if (uBase) {
        var getNameAddr = uBase.add(0x9F1900);
        Interceptor.attach(getNameAddr, {
            onEnter: function(args) { this.obj = args[0]; },
            onLeave: function(retval) {
                if (retval && !retval.isNull()) {
                    try {
                        var name = retval.readUtf8String();
                        if (name && (name.includes("RemotePlayer") || name.includes("LocalActor") || name.includes("PlayerCharacter"))) {
                            console.log("[GetName] " + name);
                        }
                    } catch (e) {}
                }
            }
        });
        console.log("[+] Hooking GameObject::GetName at: " + getNameAddr);
    }
}

console.log("[+] All hooks installed. Waiting for events...");