import frida, sys

PID = 10994
NATIVE_TF = 0x79933C7980D0

JS = f"""
const pid = {PID};
const nativeTf = ptr("{hex(NATIVE_TF)}");

rpc.exports = {{
    scan: function() {{
        console.log("============================================================");
        console.log("SCAN for managed Transform with m_CachedPtr = nativePosAddr");
        console.log("============================================================");

        var objCandidate = nativeTf.add(-0x10);
        console.log("  Candidate managed object @ " + objCandidate + " (nativeAddr-0x10)");

        var klass = objCandidate.readPointer();
        console.log("  klass @ " + klass);

        console.log("\\n[*] Dumping klass to find class name...");
        for (var off = 0; off < 0x100; off += 8) {{
            try {{
                var p = klass.add(off).readPointer();
                if (p && !p.isNull()) {{
                    try {{
                        var s = p.readCString();
                        if (s && s.length > 2 && s.length < 80) {{
                            var first = s.charCodeAt(0);
                            if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {{
                                console.log("  klass+0x" + off.toString(16) + " -> \\"" + s + "\\"");
                            }}
                        }}
                    }} catch(e) {{}}
                }}
            }} catch(e) {{}}
        }}

        console.log("\\n[*] First 32 bytes of klass candidate:");
        try {{
            var bytes = klass.readByteArray(32);
            var arr = new Uint8Array(bytes);
            var hex = "";
            for (var i = 0; i < 32; i++) {{
                hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
            }}
            console.log("  " + hex);
        }} catch(e) {{
            console.log("  [ERROR reading klass]");
        }}

        console.log("\\n[*] Managed object candidate dump:");
        try {{
            var objBytes = objCandidate.readByteArray(0x30);
            var arr = new Uint8Array(objBytes);
            var hex = "";
            for (var i = 0; i < 0x30; i++) {{
                if (i > 0 && i % 16 === 0) hex += "\\n  ";
                hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
            }}
            console.log("  " + hex);
        }} catch(e) {{}}

        var mCached = objCandidate.add(0x10).readPointer();
        console.log("\\n  Read at obj+0x10 (m_CachedPtr) = " + mCached);
        console.log("  Expected NATIVE_TF = " + nativeTf);
        console.log("  Match: " + (mCached.toString() === nativeTf.toString()));

        if (mCached.toString() === nativeTf.toString()) {{
            console.log("\\n*** FOUND MATCH! This IS the managed Transform ***");

            var module = Process.findModuleByName("GameAssembly.so");
            var exports = module.enumerateExports();
            var resolve_icall = null;
            for (var i = 0; i < exports.length; i++) {{
                if (exports[i].name.indexOf("il2cpp_resolve_icall") >= 0) {{
                    resolve_icall = exports[i].address;
                    break;
                }}
            }}

            if (resolve_icall) {{
                var resolveFn = new NativeFunction(resolve_icall, 'pointer', ['pointer']);
                var getGO = resolveFn(Memory.allocUtf8String("UnityEngine.Component::get_gameObject"));

                if (getGO && !getGO.isNull()) {{
                    var getGOFn = new NativeFunction(getGO, 'pointer', ['pointer']);
                    try {{
                        var go = getGOFn(objCandidate);
                        console.log("  GameObject returned: " + go);

                        if (go && !go.isNull()) {{
                            console.log("\\n[*] GameObject dump:");
                            try {{
                                var goBytes = go.readByteArray(0x40);
                                var arr = new Uint8Array(goBytes);
                                var hex = "";
                                for (var i = 0; i < 0x40; i++) {{
                                    if (i > 0 && i % 16 === 0) hex += "\\n  ";
                                    hex += ("0" + arr[i].toString(16)).slice(-2) + " ";
                                }}
                                console.log(hex);
                            }} catch(e) {{}}

                            // Find klass at various offsets
                            for (var o = 0; o <= 32; o += 8) {{
                                try {{
                                    var k = go.add(-o).readPointer();
                                    if (k && !k.isNull()) {{
                                        for (var co = 0; co < 0x100; co += 8) {{
                                            try {{
                                                var p = k.add(co).readPointer();
                                                if (p && !p.isNull()) {{
                                                    var s = p.readCString();
                                                    if (s && s.length > 2 && s.length < 80) {{
                                                        var fc = s.charCodeAt(0);
                                                        if ((fc >= 65 && fc <= 90) || (fc >= 97 && fc <= 122)) {{
                                                            console.log("  go-0x" + o.toString(16) + ".klass+0x" + co.toString(16) + " -> \\"" + s + "\\"");
                                                        }}
                                                    }}
                                                }}
                                            }} catch(e) {{}}
                                        }}
                                    }}
                                }} catch(e) {{}}
                            }}

                            console.log("\\n[*] Scanning for entity_id in GameObject...");
                            for (var off = 0; off < 0x200; off += 4) {{
                                try {{
                                    var val = go.add(off).readS32();
                                    if (val > 10000 && val < 9999999) {{
                                        var prev = go.add(off - 4).readS32();
                                        var next = go.add(off + 4).readS32();
                                        console.log("  entity_id? @ +0x" + off.toString(16) + " = " + val + " (prev=" + prev + ", next=" + next + ")");
                                    }}
                                }} catch(e) {{}}
                            }}
                        }}
                    }} catch(e) {{
                        console.log("  get_gameObject FAILED: " + e.message);
                    }}
                }}
            }}
        }} else {{
            console.log("\\n[*] NOT a match. Need to search differently...");
        }}

        console.log("\\n============================================================");
        return "DONE";
    }}
}};
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS)
    script.load()
    print("[*] Scanning...")
    output = script.exports_sync.scan()
    print(output)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}")
