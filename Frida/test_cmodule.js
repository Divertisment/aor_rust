'use strict';

const code = `
void test() {
}
`;

try {
    const m = new CModule(code);
    console.log('CModule keys: ' + Object.keys(m).join(', '));
    console.log('test type: ' + typeof m.test);
} catch (e) {
    console.log('Error: ' + e);
}
