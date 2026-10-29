(() => {
  const shapes = {
    sun: [['circle',{cx:12,cy:12,r:4}],['path',{d:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5'}]],
    moon: [['path',{d:'M20.7 13.3A9 9 0 0 1 10.7 3.3 9 9 0 1 0 20.7 13.3Z'}]],
    power: [['path',{d:'M12 3v9m-5.6-6.5a8.5 8.5 0 1 0 11.2 0'}]],
    stop: [['path',{d:'m8 3-5 5v8l5 5h8l5-5V8l-5-5H8Z'}],['rect',{x:9,y:9,width:6,height:6,rx:1}]],
    tag: [['path',{d:'M3 3h7l10.5 10.5a1.8 1.8 0 0 1 0 2.5L16 20.5a1.8 1.8 0 0 1-2.5 0L3 10V3Zm1 17L20 4'}],['circle',{cx:7,cy:7,r:1}]],
    tab: [['rect',{x:3,y:4,width:18,height:16,rx:3}],['path',{d:'M3 9h18m-14-3h.01M10 6h.01'}]],
    chevron: [['path',{d:'m8 10 4 4 4-4'}]],
    target: [['circle',{cx:12,cy:12,r:7}],['path',{d:'M12 2v4m0 12v4M2 12h4m12 0h4'}]],
    refresh: [['path',{d:'M20 7V3l-3 3A8 8 0 0 0 4 9m0 8v4l3-3a8 8 0 0 0 13-3M4 21v-4h4M20 3v4h-4'}]],
    popout: [['path',{d:'M14 3h7v7m0-7L10 14M10 5H4v16h16v-7'}]],
    help: [['circle',{cx:12,cy:12,r:9}],['path',{d:'M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.2.7-1.7 1.1-1.7 2.7M12 17h.01'}]],
    close: [['path',{d:'m6 6 12 12M6 18 18 6'}]],
    search: [['circle',{cx:10.5,cy:10.5,r:6.5}],['path',{d:'m16 16 5 5'}]],
    check: [['path',{d:'m5 12 4 4L19 6'}]],
    key: [['circle',{cx:8,cy:8,r:5}],['path',{d:'m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3'}]]
  };
  function draw(name, size = 20) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.75,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true','data-icon':name})) svg.setAttribute(key,value);
    for (const [tag, attrs] of shapes[name] || shapes.tab) {
      const element = document.createElementNS(ns,tag);
      for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
      svg.append(element);
    }
    return svg;
  }
  globalThis.AntiIcons = { draw };
})();
