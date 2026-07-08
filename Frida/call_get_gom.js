var moduleBase = Process.findModuleByName("GameAssembly.so").base;

// Найдем GetGameObjectManager через паттерн или xref
// Он должен быть где-то рядом с GameObject::UpdateActiveGONode
// Просто прочитаем по известному адресу статического поля — оно должно сработать

// Попробуем найти GetGameObjectManager по паттерну (он просто возвращает s_Instance)
// В ARM64 это может быть: ADRP + LDR (или ADRL + LDR)
// Давайте попробуем создать NativeFunction из xref на s_Instance

// На самом деле, если GetGameObjectManager просто возвращает s_Instance,
// Давайте лучше прочитаем сам s_Instance как часть структуры

var staticAddr = moduleBase.add(0x20EAAC0);
console.log(`[!] s_Instance addr: ${staticAddr}`);

// Пробуем интерпретировать s_Instance как hash_map структуру
// В коде: v4 = (__int64 *)((char *)GameObjectManager::s_Instance + 24);
// Значит, s_Instance + 0x18 содержит указатель на sentinel/head списка

// Давайте просто дампим больше памяти вокруг статического поля
console.log("[+] Дамп 128 байт вокруг статического поля:");
console.log(hexdump(staticAddr.readByteArray(128), {
    offset: 0,
    length: 128,
    header: true,
    ansi: true
}));
