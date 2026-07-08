'use strict';
Il2Cpp.perform(function () {
    console.log('[*] probe start');
    console.log('Has Il2Cpp:', typeof Il2Cpp);
    console.log('Has Il2Cpp.image:', Il2Cpp && typeof Il2Cpp.image);
    console.log('Has Il2Cpp.domain:', Il2Cpp && typeof Il2Cpp.domain);
    try {
        var core = Il2Cpp.image('UnityEngine.CoreModule');
        console.log('core img type:', typeof core, ' truthy:', !!core);
        console.log('core.class(\"Object\"):', core && typeof core.class, core && !!core.class('Object'));
        console.log('core.class(\"GameObject\"):', core && typeof core.class('GameObject') === 'object');
    } catch (e) { console.log('core error:', e && e.message); }
    try {
        var asm = Il2Cpp.domain.assembly('Assembly-CSharp');
        console.log('asm truthy:', !!asm, 'image truthy:', asm && !!asm.image, 'classes count:', asm && asm.image && asm.image.classes && asm.image.classes.length);
        var pcv = asm && asm.image && asm.image.class('PlayerCharacterView');
        console.log('PlayerCharacterView found:', !!pcv);
        var dcn = asm && asm.image && asm.image.class('DisplayCharacterNameWorldObjectAnchoredGui');
        console.log('DisplayCharacterNameWorldObjectAnchoredGui found:', !!dcn);
        var lcn = asm && asm.image && asm.image.class('LinkedCharacterNameLabel');
        console.log('LinkedCharacterNameLabel found:', !!lcn);
        var mb = core && core.class('MonoBehaviour');
        console.log('MonoBehaviour found:', !!mb);
    } catch (e) { console.log('asm error:', e && e.message); }
    try {
        var phot = Il2Cpp.domain.assembly('Albion.PhotonClient');
        var co6 = phot && phot.image && phot.image.class('co6');
        console.log('Albion.PhotonClient truthy:', !!phot, ' co6 found:', !!co6);
        if (co6) {
          console.log('co6.choose type:', typeof co6.choose);
          console.log('Il2Cpp.choose type:', typeof Il2Cpp.choose);
          console.log('Il2Cpp.gc type:', typeof Il2Cpp.gc);
          if (Il2Cpp.gc) console.log('Il2Cpp.gc.choose type:', typeof Il2Cpp.gc.choose);
        }
    } catch (e) { console.log('photon error:', e && e.message); }
    console.log('[*] probe done');
});
