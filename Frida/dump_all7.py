import frida, time, sys

PID = 10994

JS_CODE = """
var addrs = [
    ['0x7992e1ca7050', 'E100'],
    ['0x7992e7dcf630', 'E101'],
    ['0x7992ed103380', 'E102'],
    ['0x799323f0b800', 'E103'],
    ['0x79932a3954b0', 'E104'],
    ['0x79933c7980d0', 'E105'],
    ['0x79941bc29030', 'E106'],
];
for (var i = 0; i < addrs.length; i++) {
    var a = addrs[i][0];
    var l = addrs[i][1];
    try {
        var addr = ptr(a);
        var x = addr.readFloat();
        var y = addr.add(4).readFloat();
        var z = addr.add(8).readFloat();
        console.log(l + " @ " + addr + " -> X=" + x.toFixed(2) + " Y=" + y.toFixed(2) + " Z=" + z.toFixed(2));
    } catch(e) {
        console.log(l + " @ " + a + " -> ERROR: " + e.message);
    }
}
console.log('DONE');
"""

try:
    device = frida.get_local_device()
    session = device.attach(PID)
    script = session.create_script(JS_CODE)
    script.load()
    time.sleep(4)
    session.detach()
except Exception as e:
    print(f"[-] Error: {e}", file=sys.stderr)
