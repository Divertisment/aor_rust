'use strict';
Il2Cpp.perform(function () {
    function getFields(k) {
        try {
            var f = k.fields;
            if (!f) return [];
            if (Array.isArray(f)) return f;
            if (typeof f === 'object') { var out = []; for (var k2 in f) if (Object.prototype.hasOwnProperty.call(f, k2)) out.push(f[k2]); return out; }
        } catch (e) {}
        return [];
    }
    function readAt(inst, off, kind) {
        try { if (kind === 's32') return inst.address.add(off).readS32();
              if (kind === 'f32') return inst.address.add(off).readFloat();
              return null; } catch (e) { return null; }
    }
    var image = (function () { try { return Il2Cpp.domain.assembly('Albion.PhotonClient').image; } catch (e) { return null; } })();
    if (!image) { console.log('[!] Albion.PhotonClient missing'); return; }
    var cls = (function () { try { return image.class('co6'); } catch (e) { return null; } })();
    if (!cls) { console.log('[!] co6 class not found'); return; }
    console.log('[*] Class: ' + (cls.fullName || (cls.namespace || '') + '.' + cls.name));

    // 1) Try Choose (any version): cls.choose(), Il2Cpp.choose(cls), or scan
    var instances = [];
    try { instances = cls.choose(); } catch (e) { instances = []; }
    if ((!instances || instances.length === 0)) {
      try { instances = Il2Cpp.choose(cls); } catch (e) { instances = instances || []; }
    }
    if ((!instances || instances.length === 0)) {
      try { if (Il2Cpp.gc && Il2Cpp.gc.choose) instances = Il2Cpp.gc.choose(cls); } catch (e) { instances = instances || []; }
    }
    if ((!instances || instances.length === 0)) {
      try { if (Il2Cpp.gc && typeof Il2Cpp.gc.heap === 'function') instances = Il2Cpp.gc.heap.findInstances(cls); } catch (e) { instances = instances || []; }
    }
    if (!instances) instances = [];
    console.log('[*] choose() returned ' + instances.length + ' instances (via current bridge API)');
    if (instances.length === 0) {
      console.log('[!] choose() unavailable — enumerating live MonoBehaviour list via methods instead');
      // enumerate instances of co6 class via an instance method - find static singleton holders
      // As a fallback, look for static fields that might hold a singleton reference
      var statics = getFields(cls);
      console.log('[*] static fields of co6:');
      for (var i = 0; i < statics.length; i++) {
        var f = statics[i];
        if (f && f.isStatic) console.log('     ' + f.name + ' : ' + ((f.type && f.type.name) || '?'));
      }
      return;
    }

    var PLAYER_NAME = "KpAcuBa";
    var found = [];
    for (var i = 0; i < instances.length; i++) {
        var inst = instances[i];
        console.log('[' + i + '] @' + inst.address + ' id=' + readAt(inst,0x10,'s32') + ' x=' + readAt(inst,0x38,'f32') + ' y=' + readAt(inst,0x3c,'f32'));
        try {
            var methods = inst.class.methods;
            for (var j = 0; j < methods.length; j++) {
                var m = methods[j];
                try {
                    if (m && m.parameterCount === 0 && m.returnType && m.returnType.name === 'System.String') {
                        var r = m.invoke(inst);
                        var s = r ? r.content : null;
                        if (s === PLAYER_NAME) {
                            console.log('[!] NAME METHOD: ' + m.name + ' -> "' + s + '"');
                            console.log('[!] Instance @' + inst.address + ' co6.id=' + readAt(inst,0x10,'s32'));
                            found.push({i:i, address:inst.address, method:m.name, id:readAt(inst,0x10,'s32')});
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
    if (!found.length) console.log('[-] "' + PLAYER_NAME + '" not returned by any no-arg string method of any co6 instance');
    else console.log('[+] ' + PLAYER_NAME + ' located on ' + found.length + ' instance(s)');
});
