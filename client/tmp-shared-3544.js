/**
* @vue/shared v3.5.44
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
// @__NO_SIDE_EFFECTS__
function makeMap(str) {
  const map = /* @__PURE__ */ Object.create(null);
  for (const key of str.split(","))
    map[key] = 1;
  return (val) => val in map;
}
const EMPTY_OBJ = true ? Object.freeze({}) : {};
const EMPTY_ARR = true ? Object.freeze([]) : [];
const NOOP = () => {
};
const NO = () => false;
const isOn = (key) => key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && // uppercase letter
(key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97);
const isModelListener = (key) => key.startsWith("onUpdate:");
const extend = Object.assign;
const remove = (arr, el) => {
  const i = arr.indexOf(el);
  if (i > -1) {
    arr.splice(i, 1);
  }
};
const hasOwnProperty = Object.prototype.hasOwnProperty;
const hasOwn = (val, key) => hasOwnProperty.call(val, key);
const isArray = Array.isArray;
const isMap = (val) => toTypeString(val) === "[object Map]";
const isSet = (val) => toTypeString(val) === "[object Set]";
const isDate = (val) => toTypeString(val) === "[object Date]";
const isRegExp = (val) => toTypeString(val) === "[object RegExp]";
const isFunction = (val) => typeof val === "function";
const isString = (val) => typeof val === "string";
const isSymbol = (val) => typeof val === "symbol";
const isObject = (val) => val !== null && typeof val === "object";
const isPromise = (val) => {
  return (isObject(val) || isFunction(val)) && isFunction(val.then) && isFunction(val.catch);
};
const objectToString = Object.prototype.toString;
const toTypeString = (value) => objectToString.call(value);
const toRawType = (value) => {
  return toTypeString(value).slice(8, -1);
};
const isPlainObject = (val) => toTypeString(val) === "[object Object]";
const isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
const isReservedProp = /* @__PURE__ */ makeMap(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
);
const isBuiltInDirective = /* @__PURE__ */ makeMap(
  "bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo"
);
const cacheStringFunction = (fn) => {
  const cache = /* @__PURE__ */ Object.create(null);
  return (str) => {
    const hit = cache[str];
    return hit || (cache[str] = fn(str));
  };
};
const camelizeRE = /-\w/g;
const camelize = cacheStringFunction(
  (str) => {
    return str.replace(camelizeRE, (c) => c.slice(1).toUpperCase());
  }
);
const hyphenateRE = /\B([A-Z])/g;
const hyphenate = cacheStringFunction(
  (str) => str.replace(hyphenateRE, "-$1").toLowerCase()
);
const capitalize = cacheStringFunction((str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
});
const toHandlerKey = cacheStringFunction(
  (str) => {
    const s = str ? `on${capitalize(str)}` : ``;
    return s;
  }
);
const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
const invokeArrayFns = (fns, ...arg) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](...arg);
  }
};
const def = (obj, key, value, writable = false) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    writable,
    value
  });
};
const looseToNumber = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? val : n;
};
const toNumber = (val) => {
  const n = isString(val) ? Number(val) : NaN;
  return isNaN(n) ? val : n;
};
let _globalThis;
const getGlobalThis = () => {
  return _globalThis || (_globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
};
const identRE = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/;
function genPropsAccessExp(name) {
  return identRE.test(name) ? `__props.${name}` : `__props[${JSON.stringify(name)}]`;
}
function genCacheKey(source, options) {
  return source + JSON.stringify(
    options,
    (_, val) => typeof val === "function" ? val.toString() : val
  );
}
const PatchFlags = {
  "TEXT": 1,
  "1": "TEXT",
  "CLASS": 2,
  "2": "CLASS",
  "STYLE": 4,
  "4": "STYLE",
  "PROPS": 8,
  "8": "PROPS",
  "FULL_PROPS": 16,
  "16": "FULL_PROPS",
  "NEED_HYDRATION": 32,
  "32": "NEED_HYDRATION",
  "STABLE_FRAGMENT": 64,
  "64": "STABLE_FRAGMENT",
  "KEYED_FRAGMENT": 128,
  "128": "KEYED_FRAGMENT",
  "UNKEYED_FRAGMENT": 256,
  "256": "UNKEYED_FRAGMENT",
  "NEED_PATCH": 512,
  "512": "NEED_PATCH",
  "DYNAMIC_SLOTS": 1024,
  "1024": "DYNAMIC_SLOTS",
  "DEV_ROOT_FRAGMENT": 2048,
  "2048": "DEV_ROOT_FRAGMENT",
  "CACHED": -1,
  "-1": "CACHED",
  "BAIL": -2,
  "-2": "BAIL"
};
const PatchFlagNames = {
  [1]: `TEXT`,
  [2]: `CLASS`,
  [4]: `STYLE`,
  [8]: `PROPS`,
  [16]: `FULL_PROPS`,
  [32]: `NEED_HYDRATION`,
  [64]: `STABLE_FRAGMENT`,
  [128]: `KEYED_FRAGMENT`,
  [256]: `UNKEYED_FRAGMENT`,
  [512]: `NEED_PATCH`,
  [1024]: `DYNAMIC_SLOTS`,
  [2048]: `DEV_ROOT_FRAGMENT`,
  [-1]: `CACHED`,
  [-2]: `BAIL`
};
const ShapeFlags = {
  "ELEMENT": 1,
  "1": "ELEMENT",
  "FUNCTIONAL_COMPONENT": 2,
  "2": "FUNCTIONAL_COMPONENT",
  "STATEFUL_COMPONENT": 4,
  "4": "STATEFUL_COMPONENT",
  "TEXT_CHILDREN": 8,
  "8": "TEXT_CHILDREN",
  "ARRAY_CHILDREN": 16,
  "16": "ARRAY_CHILDREN",
  "SLOTS_CHILDREN": 32,
  "32": "SLOTS_CHILDREN",
  "TELEPORT": 64,
  "64": "TELEPORT",
  "SUSPENSE": 128,
  "128": "SUSPENSE",
  "COMPONENT_SHOULD_KEEP_ALIVE": 256,
  "256": "COMPONENT_SHOULD_KEEP_ALIVE",
  "COMPONENT_KEPT_ALIVE": 512,
  "512": "COMPONENT_KEPT_ALIVE",
  "COMPONENT": 6,
  "6": "COMPONENT"
};
const SlotFlags = {
  "STABLE": 1,
  "1": "STABLE",
  "DYNAMIC": 2,
  "2": "DYNAMIC",
  "FORWARDED": 3,
  "3": "FORWARDED"
};
const slotFlagsText = {
  [1]: "STABLE",
  [2]: "DYNAMIC",
  [3]: "FORWARDED"
};
const GLOBALS_ALLOWED = "Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt,console,Error,Symbol";
const isGloballyAllowed = /* @__PURE__ */ makeMap(GLOBALS_ALLOWED);
const isGloballyWhitelisted = isGloballyAllowed;
const range = 2;
function generateCodeFrame(source, start = 0, end = source.length) {
  start = Math.max(0, Math.min(start, source.length));
  end = Math.max(0, Math.min(end, source.length));
  if (start > end)
    return "";
  let lines = source.split(/(\r?\n)/);
  const newlineSequences = lines.filter((_, idx) => idx % 2 === 1);
  lines = lines.filter((_, idx) => idx % 2 === 0);
  let count = 0;
  const res = [];
  for (let i = 0; i < lines.length; i++) {
    count += lines[i].length + (newlineSequences[i] && newlineSequences[i].length || 0);
    if (count >= start) {
      for (let j = i - range; j <= i + range || end > count; j++) {
        if (j < 0 || j >= lines.length)
          continue;
        const line = j + 1;
        res.push(
          `${line}${" ".repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`
        );
        const lineLength = lines[j].length;
        const newLineSeqLength = newlineSequences[j] && newlineSequences[j].length || 0;
        if (j === i) {
          const pad = start - (count - (lineLength + newLineSeqLength));
          const length = Math.max(
            1,
            end > count ? lineLength - pad : end - start
          );
          res.push(`   |  ` + " ".repeat(pad) + "^".repeat(length));
        } else if (j > i) {
          if (end > count) {
            const length = Math.max(Math.min(end - count, lineLength), 1);
            res.push(`   |  ` + "^".repeat(length));
          }
          count += lineLength + newLineSeqLength;
        }
      }
      break;
    }
  }
  return res.join("\n");
}
function normalizeStyle(value) {
  if (isArray(value)) {
    const res = {};
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const normalized = isString(item) ? parseStringStyle(item) : normalizeStyle(item);
      if (normalized) {
        for (const key in normalized) {
          res[key] = normalized[key];
        }
      }
    }
    return res;
  } else if (isString(value) || isObject(value)) {
    return value;
  }
}
const listDelimiterRE = /;(?![^(]*\))/g;
const propertyDelimiterRE = /:([^]+)/;
const styleCommentRE = /"(?:[^"\\]|\\[^])*"|'(?:[^'\\]|\\[^])*'|\\[^]|\/\*[^]*?\*\//g;
function parseStringStyle(cssText) {
  const ret = {};
  cssText.replace(styleCommentRE, (match) => match.startsWith("/*") ? "" : match).split(listDelimiterRE).forEach((item) => {
    if (item) {
      const tmp = item.split(propertyDelimiterRE);
      tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
    }
  });
  return ret;
}
function stringifyStyle(styles) {
  if (!styles)
    return "";
  if (isString(styles))
    return styles;
  let ret = "";
  for (const key in styles) {
    const value = styles[key];
    if (isString(value) || typeof value === "number") {
      const normalizedKey = key.startsWith(`--`) ? key : hyphenate(key);
      ret += `${normalizedKey}:${value};`;
    }
  }
  return ret;
}
function normalizeClass(value) {
  let res = "";
  if (isString(value)) {
    res = value;
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeClass(value[i]);
      if (normalized) {
        res += normalized + " ";
      }
    }
  } else if (isObject(value)) {
    for (const name in value) {
      if (value[name]) {
        res += name + " ";
      }
    }
  }
  return res.trim();
}
function normalizeProps(props) {
  if (!props)
    return null;
  let { class: klass, style } = props;
  if (klass && !isString(klass)) {
    props.class = normalizeClass(klass);
  }
  if (style) {
    props.style = normalizeStyle(style);
  }
  return props;
}
const HTML_TAGS = "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot";
const SVG_TAGS = "svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,text,textPath,title,tspan,unknown,use,view";
const MATH_TAGS = "annotation,annotation-xml,maction,maligngroup,malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,none,semantics";
const VOID_TAGS = "area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr";
const isHTMLTag = /* @__PURE__ */ makeMap(HTML_TAGS);
const isSVGTag = /* @__PURE__ */ makeMap(SVG_TAGS);
const isMathMLTag = /* @__PURE__ */ makeMap(MATH_TAGS);
const isVoidTag = /* @__PURE__ */ makeMap(VOID_TAGS);
const specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,playsinline,readonly`;
const isSpecialBooleanAttr = /* @__PURE__ */ makeMap(specialBooleanAttrs);
const isBooleanAttr = /* @__PURE__ */ makeMap(
  specialBooleanAttrs + `,async,autofocus,autoplay,controls,default,defer,disabled,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected`
);
function includeBooleanAttr(value) {
  return !!value || value === "";
}
const unsafeAttrCharRE = /[>/="'\u0009\u000a\u000c\u000d\u0020]/;
const attrValidationCache = {};
function isSSRSafeAttrName(name) {
  if (attrValidationCache.hasOwnProperty(name)) {
    return attrValidationCache[name];
  }
  const isUnsafe = unsafeAttrCharRE.test(name);
  if (isUnsafe) {
    console.error(`unsafe attribute name: ${name}`);
  }
  return attrValidationCache[name] = !isUnsafe;
}
const propsToAttrMap = {
  acceptCharset: "accept-charset",
  className: "class",
  htmlFor: "for",
  httpEquiv: "http-equiv"
};
const isKnownHtmlAttr = /* @__PURE__ */ makeMap(
  `accept,accept-charset,accesskey,action,align,allow,alt,async,autocapitalize,autocomplete,autofocus,autoplay,background,bgcolor,border,buffered,capture,challenge,charset,checked,cite,class,code,codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,coords,crossorigin,csp,data,datetime,decoding,default,defer,dir,dirname,disabled,download,draggable,dropzone,enctype,enterkeyhint,for,form,formaction,formenctype,formmethod,formnovalidate,formtarget,headers,height,hidden,high,href,hreflang,http-equiv,icon,id,importance,inert,integrity,ismap,itemprop,keytype,kind,label,lang,language,loading,list,loop,low,manifest,max,maxlength,minlength,media,min,multiple,muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,referrerpolicy,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,selected,shape,size,sizes,slot,span,spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,target,title,translate,type,usemap,value,width,wrap`
);
const isKnownSvgAttr = /* @__PURE__ */ makeMap(
  `xmlns,accent-height,accumulate,additive,alignment-baseline,alphabetic,amplitude,arabic-form,ascent,attributeName,attributeType,azimuth,baseFrequency,baseline-shift,baseProfile,bbox,begin,bias,by,calcMode,cap-height,class,clip,clipPathUnits,clip-path,clip-rule,color,color-interpolation,color-interpolation-filters,color-profile,color-rendering,contentScriptType,contentStyleType,crossorigin,cursor,cx,cy,d,decelerate,descent,diffuseConstant,direction,display,divisor,dominant-baseline,dur,dx,dy,edgeMode,elevation,enable-background,end,exponent,fill,fill-opacity,fill-rule,filter,filterRes,filterUnits,flood-color,flood-opacity,font-family,font-size,font-size-adjust,font-stretch,font-style,font-variant,font-weight,format,from,fr,fx,fy,g1,g2,glyph-name,glyph-orientation-horizontal,glyph-orientation-vertical,glyphRef,gradientTransform,gradientUnits,hanging,height,href,hreflang,horiz-adv-x,horiz-origin-x,id,ideographic,image-rendering,in,in2,intercept,k,k1,k2,k3,k4,kernelMatrix,kernelUnitLength,kerning,keyPoints,keySplines,keyTimes,lang,lengthAdjust,letter-spacing,lighting-color,limitingConeAngle,local,marker-end,marker-mid,marker-start,markerHeight,markerUnits,markerWidth,mask,maskContentUnits,maskUnits,mathematical,max,media,method,min,mode,name,numOctaves,offset,opacity,operator,order,orient,orientation,origin,overflow,overline-position,overline-thickness,panose-1,paint-order,path,pathLength,patternContentUnits,patternTransform,patternUnits,ping,pointer-events,points,pointsAtX,pointsAtY,pointsAtZ,preserveAlpha,preserveAspectRatio,primitiveUnits,r,radius,referrerPolicy,refX,refY,rel,rendering-intent,repeatCount,repeatDur,requiredExtensions,requiredFeatures,restart,result,rotate,rx,ry,scale,seed,shape-rendering,slope,spacing,specularConstant,specularExponent,speed,spreadMethod,startOffset,stdDeviation,stemh,stemv,stitchTiles,stop-color,stop-opacity,strikethrough-position,strikethrough-thickness,string,stroke,stroke-dasharray,stroke-dashoffset,stroke-linecap,stroke-linejoin,stroke-miterlimit,stroke-opacity,stroke-width,style,surfaceScale,systemLanguage,tabindex,tableValues,target,targetX,targetY,text-anchor,text-decoration,text-rendering,textLength,to,transform,transform-origin,type,u1,u2,underline-position,underline-thickness,unicode,unicode-bidi,unicode-range,units-per-em,v-alphabetic,v-hanging,v-ideographic,v-mathematical,values,vector-effect,version,vert-adv-y,vert-origin-x,vert-origin-y,viewBox,viewTarget,visibility,width,widths,word-spacing,writing-mode,x,x-height,x1,x2,xChannelSelector,xlink:actuate,xlink:arcrole,xlink:href,xlink:role,xlink:show,xlink:title,xlink:type,xmlns:xlink,xml:base,xml:lang,xml:space,y,y1,y2,yChannelSelector,z,zoomAndPan`
);
const isKnownMathMLAttr = /* @__PURE__ */ makeMap(
  `accent,accentunder,actiontype,align,alignmentscope,altimg,altimg-height,altimg-valign,altimg-width,alttext,bevelled,close,columnsalign,columnlines,columnspan,denomalign,depth,dir,display,displaystyle,encoding,equalcolumns,equalrows,fence,fontstyle,fontweight,form,frame,framespacing,groupalign,height,href,id,indentalign,indentalignfirst,indentalignlast,indentshift,indentshiftfirst,indentshiftlast,indextype,justify,largetop,largeop,lquote,lspace,mathbackground,mathcolor,mathsize,mathvariant,maxsize,minlabelspacing,mode,other,overflow,position,rowalign,rowlines,rowspan,rquote,rspace,scriptlevel,scriptminsize,scriptsizemultiplier,selection,separator,separators,shift,side,src,stackalign,stretchy,subscriptshift,superscriptshift,symmetric,voffset,width,widths,xlink:href,xlink:show,xlink:type,xmlns`
);
function isRenderableAttrValue(value) {
  if (value == null) {
    return false;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}
const escapeRE = /["'&<>]/;
function escapeHtml(string) {
  const str = "" + string;
  const match = escapeRE.exec(str);
  if (!match) {
    return str;
  }
  let html = "";
  let escaped;
  let index;
  let lastIndex = 0;
  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34:
        escaped = "&quot;";
        break;
      case 38:
        escaped = "&amp;";
        break;
      case 39:
        escaped = "&#39;";
        break;
      case 60:
        escaped = "&lt;";
        break;
      case 62:
        escaped = "&gt;";
        break;
      default:
        continue;
    }
    if (lastIndex !== index) {
      html += str.slice(lastIndex, index);
    }
    lastIndex = index + 1;
    html += escaped;
  }
  return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
}
const commentStripRE = /^(?:-?>)+|<!--|-->|--!>|<!-$/g;
function escapeHtmlComment(src) {
  let prev;
  do {
    prev = src;
    src = src.replace(commentStripRE, "");
  } while (src !== prev);
  return src;
}
const cssVarNameEscapeSymbolsRE = /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
function getEscapedCssVarName(key, doubleEscape) {
  return key.replace(
    cssVarNameEscapeSymbolsRE,
    (s) => doubleEscape ? s === '"' ? '\\\\\\"' : `\\\\${s}` : `\\${s}`
  );
}
function looseCompareArrays(a, b, seen) {
  if (a.length !== b.length)
    return false;
  let equal = true;
  for (let i = 0; equal && i < a.length; i++) {
    equal = looseEqual(a[i], b[i], seen);
  }
  return equal;
}
function looseCompareCollections(a, b, seen) {
  if (a.size !== b.size)
    return false;
  const candidates = Array.from(b);
  const matched = new Uint8Array(candidates.length);
  for (const item of a) {
    let index = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (!matched[i] && looseEqual(item, candidates[i], seen)) {
        index = i;
        break;
      }
    }
    if (index < 0)
      return false;
    matched[index] = 1;
  }
  return true;
}
function looseCompareObjects(a, b, seen) {
  let aValidType = isMap(a);
  let bValidType = isMap(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareCollections(a, b, seen) : false;
  }
  aValidType = isSet(a);
  bValidType = isSet(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareCollections(a, b, seen) : false;
  }
  const aKeysCount = Object.keys(a).length;
  const bKeysCount = Object.keys(b).length;
  if (aKeysCount !== bKeysCount) {
    return false;
  }
  for (const key in a) {
    const aHasKey = a.hasOwnProperty(key);
    const bHasKey = b.hasOwnProperty(key);
    if (aHasKey && !bHasKey || !aHasKey && bHasKey || !looseEqual(a[key], b[key], seen)) {
      return false;
    }
  }
  return String(a) === String(b);
}
function looseCompareNested(a, b, seen, compare) {
  if (!seen) {
    seen = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()];
  }
  const [seenA, seenB] = seen;
  if (seenA.has(a) || seenB.has(b)) {
    return seenA.get(a) === b && seenB.get(b) === a;
  }
  seenA.set(a, b);
  seenB.set(b, a);
  const equal = compare(a, b, seen);
  seenA.delete(a);
  seenB.delete(b);
  return equal;
}
function looseEqual(a, b, seen) {
  if (a === b)
    return true;
  let aValidType = isDate(a);
  let bValidType = isDate(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? a.getTime() === b.getTime() : false;
  }
  aValidType = isSymbol(a);
  bValidType = isSymbol(b);
  if (aValidType || bValidType) {
    return a === b;
  }
  aValidType = isArray(a);
  bValidType = isArray(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareNested(a, b, seen, looseCompareArrays) : false;
  }
  aValidType = isObject(a);
  bValidType = isObject(b);
  if (aValidType || bValidType) {
    if (!aValidType || !bValidType) {
      return false;
    }
    return looseCompareNested(a, b, seen, looseCompareObjects);
  }
  return String(a) === String(b);
}
function looseIndexOf(arr, val) {
  return arr.findIndex((item) => looseEqual(item, val));
}
const isRef = (val) => {
  return !!(val && val["__v_isRef"] === true);
};
const toDisplayString = (val) => {
  return isString(val) ? val : val == null ? "" : isArray(val) || isObject(val) && (val.toString === objectToString || !isFunction(val.toString)) ? isRef(val) ? toDisplayString(val.value) : JSON.stringify(val, replacer, 2) : String(val);
};
const replacer = (_key, val) => {
  if (isRef(val)) {
    return replacer(_key, val.value);
  } else if (isMap(val)) {
    return {
      [`Map(${val.size})`]: [...val.entries()].reduce(
        (entries, [key, val2], i) => {
          entries[stringifySymbol(key, i) + " =>"] = val2;
          return entries;
        },
        {}
      )
    };
  } else if (isSet(val)) {
    return {
      [`Set(${val.size})`]: [...val.values()].map((v) => stringifySymbol(v))
    };
  } else if (isSymbol(val)) {
    return stringifySymbol(val);
  } else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
    return String(val);
  }
  return val;
};
const stringifySymbol = (v, i = "") => {
  var _a;
  return (
    // Symbol.description in es2019+ so we need to cast here to pass
    // the lib: es2016 check
    isSymbol(v) ? `Symbol(${(_a = v.description) != null ? _a : i})` : v
  );
};
function normalizeCssVarValue(value) {
  if (value == null) {
    return "initial";
  }
  if (typeof value === "string") {
    return value === "" ? " " : value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (true) {
      console.warn(
        "[Vue warn] Invalid value used for CSS binding. Expected a string or a finite number but received:",
        value
      );
    }
  }
  return String(value);
}
export { EMPTY_ARR, EMPTY_OBJ, NO, NOOP, PatchFlagNames, PatchFlags, ShapeFlags, SlotFlags, camelize, capitalize, cssVarNameEscapeSymbolsRE, def, escapeHtml, escapeHtmlComment, extend, genCacheKey, genPropsAccessExp, generateCodeFrame, getEscapedCssVarName, getGlobalThis, hasChanged, hasOwn, hyphenate, includeBooleanAttr, invokeArrayFns, isArray, isBooleanAttr, isBuiltInDirective, isDate, isFunction, isGloballyAllowed, isGloballyWhitelisted, isHTMLTag, isIntegerKey, isKnownHtmlAttr, isKnownMathMLAttr, isKnownSvgAttr, isMap, isMathMLTag, isModelListener, isObject, isOn, isPlainObject, isPromise, isRegExp, isRenderableAttrValue, isReservedProp, isSSRSafeAttrName, isSVGTag, isSet, isSpecialBooleanAttr, isString, isSymbol, isVoidTag, looseEqual, looseIndexOf, looseToNumber, makeMap, normalizeClass, normalizeCssVarValue, normalizeProps, normalizeStyle, objectToString, parseStringStyle, propsToAttrMap, remove, slotFlagsText, stringifyStyle, toDisplayString, toHandlerKey, toNumber, toRawType, toTypeString };

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNoYXJlZC5lc20tYnVuZGxlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiogQHZ1ZS9zaGFyZWQgdjMuNS40NFxuKiAoYykgMjAxOC1wcmVzZW50IFl1eGkgKEV2YW4pIFlvdSBhbmQgVnVlIGNvbnRyaWJ1dG9yc1xuKiBAbGljZW5zZSBNSVRcbioqL1xuLy8gQF9fTk9fU0lERV9FRkZFQ1RTX19cbmZ1bmN0aW9uIG1ha2VNYXAoc3RyKSB7XG4gIGNvbnN0IG1hcCA9IC8qIEBfX1BVUkVfXyAqLyBPYmplY3QuY3JlYXRlKG51bGwpO1xuICBmb3IgKGNvbnN0IGtleSBvZiBzdHIuc3BsaXQoXCIsXCIpKSBtYXBba2V5XSA9IDE7XG4gIHJldHVybiAodmFsKSA9PiB2YWwgaW4gbWFwO1xufVxuXG5jb25zdCBFTVBUWV9PQkogPSAhIShwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gXCJwcm9kdWN0aW9uXCIpID8gT2JqZWN0LmZyZWV6ZSh7fSkgOiB7fTtcbmNvbnN0IEVNUFRZX0FSUiA9ICEhKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIikgPyBPYmplY3QuZnJlZXplKFtdKSA6IFtdO1xuY29uc3QgTk9PUCA9ICgpID0+IHtcbn07XG5jb25zdCBOTyA9ICgpID0+IGZhbHNlO1xuY29uc3QgaXNPbiA9IChrZXkpID0+IGtleS5jaGFyQ29kZUF0KDApID09PSAxMTEgJiYga2V5LmNoYXJDb2RlQXQoMSkgPT09IDExMCAmJiAvLyB1cHBlcmNhc2UgbGV0dGVyXG4oa2V5LmNoYXJDb2RlQXQoMikgPiAxMjIgfHwga2V5LmNoYXJDb2RlQXQoMikgPCA5Nyk7XG5jb25zdCBpc01vZGVsTGlzdGVuZXIgPSAoa2V5KSA9PiBrZXkuc3RhcnRzV2l0aChcIm9uVXBkYXRlOlwiKTtcbmNvbnN0IGV4dGVuZCA9IE9iamVjdC5hc3NpZ247XG5jb25zdCByZW1vdmUgPSAoYXJyLCBlbCkgPT4ge1xuICBjb25zdCBpID0gYXJyLmluZGV4T2YoZWwpO1xuICBpZiAoaSA+IC0xKSB7XG4gICAgYXJyLnNwbGljZShpLCAxKTtcbiAgfVxufTtcbmNvbnN0IGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbmNvbnN0IGhhc093biA9ICh2YWwsIGtleSkgPT4gaGFzT3duUHJvcGVydHkuY2FsbCh2YWwsIGtleSk7XG5jb25zdCBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcbmNvbnN0IGlzTWFwID0gKHZhbCkgPT4gdG9UeXBlU3RyaW5nKHZhbCkgPT09IFwiW29iamVjdCBNYXBdXCI7XG5jb25zdCBpc1NldCA9ICh2YWwpID0+IHRvVHlwZVN0cmluZyh2YWwpID09PSBcIltvYmplY3QgU2V0XVwiO1xuY29uc3QgaXNEYXRlID0gKHZhbCkgPT4gdG9UeXBlU3RyaW5nKHZhbCkgPT09IFwiW29iamVjdCBEYXRlXVwiO1xuY29uc3QgaXNSZWdFeHAgPSAodmFsKSA9PiB0b1R5cGVTdHJpbmcodmFsKSA9PT0gXCJbb2JqZWN0IFJlZ0V4cF1cIjtcbmNvbnN0IGlzRnVuY3Rpb24gPSAodmFsKSA9PiB0eXBlb2YgdmFsID09PSBcImZ1bmN0aW9uXCI7XG5jb25zdCBpc1N0cmluZyA9ICh2YWwpID0+IHR5cGVvZiB2YWwgPT09IFwic3RyaW5nXCI7XG5jb25zdCBpc1N5bWJvbCA9ICh2YWwpID0+IHR5cGVvZiB2YWwgPT09IFwic3ltYm9sXCI7XG5jb25zdCBpc09iamVjdCA9ICh2YWwpID0+IHZhbCAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsID09PSBcIm9iamVjdFwiO1xuY29uc3QgaXNQcm9taXNlID0gKHZhbCkgPT4ge1xuICByZXR1cm4gKGlzT2JqZWN0KHZhbCkgfHwgaXNGdW5jdGlvbih2YWwpKSAmJiBpc0Z1bmN0aW9uKHZhbC50aGVuKSAmJiBpc0Z1bmN0aW9uKHZhbC5jYXRjaCk7XG59O1xuY29uc3Qgb2JqZWN0VG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuY29uc3QgdG9UeXBlU3RyaW5nID0gKHZhbHVlKSA9PiBvYmplY3RUb1N0cmluZy5jYWxsKHZhbHVlKTtcbmNvbnN0IHRvUmF3VHlwZSA9ICh2YWx1ZSkgPT4ge1xuICByZXR1cm4gdG9UeXBlU3RyaW5nKHZhbHVlKS5zbGljZSg4LCAtMSk7XG59O1xuY29uc3QgaXNQbGFpbk9iamVjdCA9ICh2YWwpID0+IHRvVHlwZVN0cmluZyh2YWwpID09PSBcIltvYmplY3QgT2JqZWN0XVwiO1xuY29uc3QgaXNJbnRlZ2VyS2V5ID0gKGtleSkgPT4gaXNTdHJpbmcoa2V5KSAmJiBrZXkgIT09IFwiTmFOXCIgJiYga2V5WzBdICE9PSBcIi1cIiAmJiBcIlwiICsgcGFyc2VJbnQoa2V5LCAxMCkgPT09IGtleTtcbmNvbnN0IGlzUmVzZXJ2ZWRQcm9wID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoXG4gIC8vIHRoZSBsZWFkaW5nIGNvbW1hIGlzIGludGVudGlvbmFsIHNvIGVtcHR5IHN0cmluZyBcIlwiIGlzIGFsc28gaW5jbHVkZWRcbiAgXCIsa2V5LHJlZixyZWZfZm9yLHJlZl9rZXksb25Wbm9kZUJlZm9yZU1vdW50LG9uVm5vZGVNb3VudGVkLG9uVm5vZGVCZWZvcmVVcGRhdGUsb25Wbm9kZVVwZGF0ZWQsb25Wbm9kZUJlZm9yZVVubW91bnQsb25Wbm9kZVVubW91bnRlZFwiXG4pO1xuY29uc3QgaXNCdWlsdEluRGlyZWN0aXZlID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoXG4gIFwiYmluZCxjbG9hayxlbHNlLWlmLGVsc2UsZm9yLGh0bWwsaWYsbW9kZWwsb24sb25jZSxwcmUsc2hvdyxzbG90LHRleHQsbWVtb1wiXG4pO1xuY29uc3QgY2FjaGVTdHJpbmdGdW5jdGlvbiA9IChmbikgPT4ge1xuICBjb25zdCBjYWNoZSA9IC8qIEBfX1BVUkVfXyAqLyBPYmplY3QuY3JlYXRlKG51bGwpO1xuICByZXR1cm4gKChzdHIpID0+IHtcbiAgICBjb25zdCBoaXQgPSBjYWNoZVtzdHJdO1xuICAgIHJldHVybiBoaXQgfHwgKGNhY2hlW3N0cl0gPSBmbihzdHIpKTtcbiAgfSk7XG59O1xuY29uc3QgY2FtZWxpemVSRSA9IC8tXFx3L2c7XG5jb25zdCBjYW1lbGl6ZSA9IGNhY2hlU3RyaW5nRnVuY3Rpb24oXG4gIChzdHIpID0+IHtcbiAgICByZXR1cm4gc3RyLnJlcGxhY2UoY2FtZWxpemVSRSwgKGMpID0+IGMuc2xpY2UoMSkudG9VcHBlckNhc2UoKSk7XG4gIH1cbik7XG5jb25zdCBoeXBoZW5hdGVSRSA9IC9cXEIoW0EtWl0pL2c7XG5jb25zdCBoeXBoZW5hdGUgPSBjYWNoZVN0cmluZ0Z1bmN0aW9uKFxuICAoc3RyKSA9PiBzdHIucmVwbGFjZShoeXBoZW5hdGVSRSwgXCItJDFcIikudG9Mb3dlckNhc2UoKVxuKTtcbmNvbnN0IGNhcGl0YWxpemUgPSBjYWNoZVN0cmluZ0Z1bmN0aW9uKChzdHIpID0+IHtcbiAgcmV0dXJuIHN0ci5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHN0ci5zbGljZSgxKTtcbn0pO1xuY29uc3QgdG9IYW5kbGVyS2V5ID0gY2FjaGVTdHJpbmdGdW5jdGlvbihcbiAgKHN0cikgPT4ge1xuICAgIGNvbnN0IHMgPSBzdHIgPyBgb24ke2NhcGl0YWxpemUoc3RyKX1gIDogYGA7XG4gICAgcmV0dXJuIHM7XG4gIH1cbik7XG5jb25zdCBoYXNDaGFuZ2VkID0gKHZhbHVlLCBvbGRWYWx1ZSkgPT4gIU9iamVjdC5pcyh2YWx1ZSwgb2xkVmFsdWUpO1xuY29uc3QgaW52b2tlQXJyYXlGbnMgPSAoZm5zLCAuLi5hcmcpID0+IHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbnMubGVuZ3RoOyBpKyspIHtcbiAgICBmbnNbaV0oLi4uYXJnKTtcbiAgfVxufTtcbmNvbnN0IGRlZiA9IChvYmosIGtleSwgdmFsdWUsIHdyaXRhYmxlID0gZmFsc2UpID0+IHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgIHdyaXRhYmxlLFxuICAgIHZhbHVlXG4gIH0pO1xufTtcbmNvbnN0IGxvb3NlVG9OdW1iZXIgPSAodmFsKSA9PiB7XG4gIGNvbnN0IG4gPSBwYXJzZUZsb2F0KHZhbCk7XG4gIHJldHVybiBpc05hTihuKSA/IHZhbCA6IG47XG59O1xuY29uc3QgdG9OdW1iZXIgPSAodmFsKSA9PiB7XG4gIGNvbnN0IG4gPSBpc1N0cmluZyh2YWwpID8gTnVtYmVyKHZhbCkgOiBOYU47XG4gIHJldHVybiBpc05hTihuKSA/IHZhbCA6IG47XG59O1xubGV0IF9nbG9iYWxUaGlzO1xuY29uc3QgZ2V0R2xvYmFsVGhpcyA9ICgpID0+IHtcbiAgcmV0dXJuIF9nbG9iYWxUaGlzIHx8IChfZ2xvYmFsVGhpcyA9IHR5cGVvZiBnbG9iYWxUaGlzICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsVGhpcyA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDoge30pO1xufTtcbmNvbnN0IGlkZW50UkUgPSAvXltfJGEtekEtWlxceEEwLVxcdUZGRkZdW18kYS16QS1aMC05XFx4QTAtXFx1RkZGRl0qJC87XG5mdW5jdGlvbiBnZW5Qcm9wc0FjY2Vzc0V4cChuYW1lKSB7XG4gIHJldHVybiBpZGVudFJFLnRlc3QobmFtZSkgPyBgX19wcm9wcy4ke25hbWV9YCA6IGBfX3Byb3BzWyR7SlNPTi5zdHJpbmdpZnkobmFtZSl9XWA7XG59XG5mdW5jdGlvbiBnZW5DYWNoZUtleShzb3VyY2UsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIHNvdXJjZSArIEpTT04uc3RyaW5naWZ5KFxuICAgIG9wdGlvbnMsXG4gICAgKF8sIHZhbCkgPT4gdHlwZW9mIHZhbCA9PT0gXCJmdW5jdGlvblwiID8gdmFsLnRvU3RyaW5nKCkgOiB2YWxcbiAgKTtcbn1cblxuY29uc3QgUGF0Y2hGbGFncyA9IHtcbiAgXCJURVhUXCI6IDEsXG4gIFwiMVwiOiBcIlRFWFRcIixcbiAgXCJDTEFTU1wiOiAyLFxuICBcIjJcIjogXCJDTEFTU1wiLFxuICBcIlNUWUxFXCI6IDQsXG4gIFwiNFwiOiBcIlNUWUxFXCIsXG4gIFwiUFJPUFNcIjogOCxcbiAgXCI4XCI6IFwiUFJPUFNcIixcbiAgXCJGVUxMX1BST1BTXCI6IDE2LFxuICBcIjE2XCI6IFwiRlVMTF9QUk9QU1wiLFxuICBcIk5FRURfSFlEUkFUSU9OXCI6IDMyLFxuICBcIjMyXCI6IFwiTkVFRF9IWURSQVRJT05cIixcbiAgXCJTVEFCTEVfRlJBR01FTlRcIjogNjQsXG4gIFwiNjRcIjogXCJTVEFCTEVfRlJBR01FTlRcIixcbiAgXCJLRVlFRF9GUkFHTUVOVFwiOiAxMjgsXG4gIFwiMTI4XCI6IFwiS0VZRURfRlJBR01FTlRcIixcbiAgXCJVTktFWUVEX0ZSQUdNRU5UXCI6IDI1NixcbiAgXCIyNTZcIjogXCJVTktFWUVEX0ZSQUdNRU5UXCIsXG4gIFwiTkVFRF9QQVRDSFwiOiA1MTIsXG4gIFwiNTEyXCI6IFwiTkVFRF9QQVRDSFwiLFxuICBcIkRZTkFNSUNfU0xPVFNcIjogMTAyNCxcbiAgXCIxMDI0XCI6IFwiRFlOQU1JQ19TTE9UU1wiLFxuICBcIkRFVl9ST09UX0ZSQUdNRU5UXCI6IDIwNDgsXG4gIFwiMjA0OFwiOiBcIkRFVl9ST09UX0ZSQUdNRU5UXCIsXG4gIFwiQ0FDSEVEXCI6IC0xLFxuICBcIi0xXCI6IFwiQ0FDSEVEXCIsXG4gIFwiQkFJTFwiOiAtMixcbiAgXCItMlwiOiBcIkJBSUxcIlxufTtcbmNvbnN0IFBhdGNoRmxhZ05hbWVzID0ge1xuICBbMV06IGBURVhUYCxcbiAgWzJdOiBgQ0xBU1NgLFxuICBbNF06IGBTVFlMRWAsXG4gIFs4XTogYFBST1BTYCxcbiAgWzE2XTogYEZVTExfUFJPUFNgLFxuICBbMzJdOiBgTkVFRF9IWURSQVRJT05gLFxuICBbNjRdOiBgU1RBQkxFX0ZSQUdNRU5UYCxcbiAgWzEyOF06IGBLRVlFRF9GUkFHTUVOVGAsXG4gIFsyNTZdOiBgVU5LRVlFRF9GUkFHTUVOVGAsXG4gIFs1MTJdOiBgTkVFRF9QQVRDSGAsXG4gIFsxMDI0XTogYERZTkFNSUNfU0xPVFNgLFxuICBbMjA0OF06IGBERVZfUk9PVF9GUkFHTUVOVGAsXG4gIFstMV06IGBDQUNIRURgLFxuICBbLTJdOiBgQkFJTGBcbn07XG5cbmNvbnN0IFNoYXBlRmxhZ3MgPSB7XG4gIFwiRUxFTUVOVFwiOiAxLFxuICBcIjFcIjogXCJFTEVNRU5UXCIsXG4gIFwiRlVOQ1RJT05BTF9DT01QT05FTlRcIjogMixcbiAgXCIyXCI6IFwiRlVOQ1RJT05BTF9DT01QT05FTlRcIixcbiAgXCJTVEFURUZVTF9DT01QT05FTlRcIjogNCxcbiAgXCI0XCI6IFwiU1RBVEVGVUxfQ09NUE9ORU5UXCIsXG4gIFwiVEVYVF9DSElMRFJFTlwiOiA4LFxuICBcIjhcIjogXCJURVhUX0NISUxEUkVOXCIsXG4gIFwiQVJSQVlfQ0hJTERSRU5cIjogMTYsXG4gIFwiMTZcIjogXCJBUlJBWV9DSElMRFJFTlwiLFxuICBcIlNMT1RTX0NISUxEUkVOXCI6IDMyLFxuICBcIjMyXCI6IFwiU0xPVFNfQ0hJTERSRU5cIixcbiAgXCJURUxFUE9SVFwiOiA2NCxcbiAgXCI2NFwiOiBcIlRFTEVQT1JUXCIsXG4gIFwiU1VTUEVOU0VcIjogMTI4LFxuICBcIjEyOFwiOiBcIlNVU1BFTlNFXCIsXG4gIFwiQ09NUE9ORU5UX1NIT1VMRF9LRUVQX0FMSVZFXCI6IDI1NixcbiAgXCIyNTZcIjogXCJDT01QT05FTlRfU0hPVUxEX0tFRVBfQUxJVkVcIixcbiAgXCJDT01QT05FTlRfS0VQVF9BTElWRVwiOiA1MTIsXG4gIFwiNTEyXCI6IFwiQ09NUE9ORU5UX0tFUFRfQUxJVkVcIixcbiAgXCJDT01QT05FTlRcIjogNixcbiAgXCI2XCI6IFwiQ09NUE9ORU5UXCJcbn07XG5cbmNvbnN0IFNsb3RGbGFncyA9IHtcbiAgXCJTVEFCTEVcIjogMSxcbiAgXCIxXCI6IFwiU1RBQkxFXCIsXG4gIFwiRFlOQU1JQ1wiOiAyLFxuICBcIjJcIjogXCJEWU5BTUlDXCIsXG4gIFwiRk9SV0FSREVEXCI6IDMsXG4gIFwiM1wiOiBcIkZPUldBUkRFRFwiXG59O1xuY29uc3Qgc2xvdEZsYWdzVGV4dCA9IHtcbiAgWzFdOiBcIlNUQUJMRVwiLFxuICBbMl06IFwiRFlOQU1JQ1wiLFxuICBbM106IFwiRk9SV0FSREVEXCJcbn07XG5cbmNvbnN0IEdMT0JBTFNfQUxMT1dFRCA9IFwiSW5maW5pdHksdW5kZWZpbmVkLE5hTixpc0Zpbml0ZSxpc05hTixwYXJzZUZsb2F0LHBhcnNlSW50LGRlY29kZVVSSSxkZWNvZGVVUklDb21wb25lbnQsZW5jb2RlVVJJLGVuY29kZVVSSUNvbXBvbmVudCxNYXRoLE51bWJlcixEYXRlLEFycmF5LE9iamVjdCxCb29sZWFuLFN0cmluZyxSZWdFeHAsTWFwLFNldCxKU09OLEludGwsQmlnSW50LGNvbnNvbGUsRXJyb3IsU3ltYm9sXCI7XG5jb25zdCBpc0dsb2JhbGx5QWxsb3dlZCA9IC8qIEBfX1BVUkVfXyAqLyBtYWtlTWFwKEdMT0JBTFNfQUxMT1dFRCk7XG5jb25zdCBpc0dsb2JhbGx5V2hpdGVsaXN0ZWQgPSBpc0dsb2JhbGx5QWxsb3dlZDtcblxuY29uc3QgcmFuZ2UgPSAyO1xuZnVuY3Rpb24gZ2VuZXJhdGVDb2RlRnJhbWUoc291cmNlLCBzdGFydCA9IDAsIGVuZCA9IHNvdXJjZS5sZW5ndGgpIHtcbiAgc3RhcnQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihzdGFydCwgc291cmNlLmxlbmd0aCkpO1xuICBlbmQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihlbmQsIHNvdXJjZS5sZW5ndGgpKTtcbiAgaWYgKHN0YXJ0ID4gZW5kKSByZXR1cm4gXCJcIjtcbiAgbGV0IGxpbmVzID0gc291cmNlLnNwbGl0KC8oXFxyP1xcbikvKTtcbiAgY29uc3QgbmV3bGluZVNlcXVlbmNlcyA9IGxpbmVzLmZpbHRlcigoXywgaWR4KSA9PiBpZHggJSAyID09PSAxKTtcbiAgbGluZXMgPSBsaW5lcy5maWx0ZXIoKF8sIGlkeCkgPT4gaWR4ICUgMiA9PT0gMCk7XG4gIGxldCBjb3VudCA9IDA7XG4gIGNvbnN0IHJlcyA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY291bnQgKz0gbGluZXNbaV0ubGVuZ3RoICsgKG5ld2xpbmVTZXF1ZW5jZXNbaV0gJiYgbmV3bGluZVNlcXVlbmNlc1tpXS5sZW5ndGggfHwgMCk7XG4gICAgaWYgKGNvdW50ID49IHN0YXJ0KSB7XG4gICAgICBmb3IgKGxldCBqID0gaSAtIHJhbmdlOyBqIDw9IGkgKyByYW5nZSB8fCBlbmQgPiBjb3VudDsgaisrKSB7XG4gICAgICAgIGlmIChqIDwgMCB8fCBqID49IGxpbmVzLmxlbmd0aCkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBqICsgMTtcbiAgICAgICAgcmVzLnB1c2goXG4gICAgICAgICAgYCR7bGluZX0ke1wiIFwiLnJlcGVhdChNYXRoLm1heCgzIC0gU3RyaW5nKGxpbmUpLmxlbmd0aCwgMCkpfXwgICR7bGluZXNbal19YFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBsaW5lTGVuZ3RoID0gbGluZXNbal0ubGVuZ3RoO1xuICAgICAgICBjb25zdCBuZXdMaW5lU2VxTGVuZ3RoID0gbmV3bGluZVNlcXVlbmNlc1tqXSAmJiBuZXdsaW5lU2VxdWVuY2VzW2pdLmxlbmd0aCB8fCAwO1xuICAgICAgICBpZiAoaiA9PT0gaSkge1xuICAgICAgICAgIGNvbnN0IHBhZCA9IHN0YXJ0IC0gKGNvdW50IC0gKGxpbmVMZW5ndGggKyBuZXdMaW5lU2VxTGVuZ3RoKSk7XG4gICAgICAgICAgY29uc3QgbGVuZ3RoID0gTWF0aC5tYXgoXG4gICAgICAgICAgICAxLFxuICAgICAgICAgICAgZW5kID4gY291bnQgPyBsaW5lTGVuZ3RoIC0gcGFkIDogZW5kIC0gc3RhcnRcbiAgICAgICAgICApO1xuICAgICAgICAgIHJlcy5wdXNoKGAgICB8ICBgICsgXCIgXCIucmVwZWF0KHBhZCkgKyBcIl5cIi5yZXBlYXQobGVuZ3RoKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoaiA+IGkpIHtcbiAgICAgICAgICBpZiAoZW5kID4gY291bnQpIHtcbiAgICAgICAgICAgIGNvbnN0IGxlbmd0aCA9IE1hdGgubWF4KE1hdGgubWluKGVuZCAtIGNvdW50LCBsaW5lTGVuZ3RoKSwgMSk7XG4gICAgICAgICAgICByZXMucHVzaChgICAgfCAgYCArIFwiXlwiLnJlcGVhdChsZW5ndGgpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY291bnQgKz0gbGluZUxlbmd0aCArIG5ld0xpbmVTZXFMZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0eWxlKHZhbHVlKSB7XG4gIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IHJlcyA9IHt9O1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdmFsdWUubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGl0ZW0gPSB2YWx1ZVtpXTtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBpc1N0cmluZyhpdGVtKSA/IHBhcnNlU3RyaW5nU3R5bGUoaXRlbSkgOiBub3JtYWxpemVTdHlsZShpdGVtKTtcbiAgICAgIGlmIChub3JtYWxpemVkKSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IGluIG5vcm1hbGl6ZWQpIHtcbiAgICAgICAgICByZXNba2V5XSA9IG5vcm1hbGl6ZWRba2V5XTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9IGVsc2UgaWYgKGlzU3RyaW5nKHZhbHVlKSB8fCBpc09iamVjdCh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbn1cbmNvbnN0IGxpc3REZWxpbWl0ZXJSRSA9IC87KD8hW14oXSpcXCkpL2c7XG5jb25zdCBwcm9wZXJ0eURlbGltaXRlclJFID0gLzooW15dKykvO1xuY29uc3Qgc3R5bGVDb21tZW50UkUgPSAvXCIoPzpbXlwiXFxcXF18XFxcXFteXSkqXCJ8Jyg/OlteJ1xcXFxdfFxcXFxbXl0pKid8XFxcXFteXXxcXC9cXCpbXl0qP1xcKlxcLy9nO1xuZnVuY3Rpb24gcGFyc2VTdHJpbmdTdHlsZShjc3NUZXh0KSB7XG4gIGNvbnN0IHJldCA9IHt9O1xuICBjc3NUZXh0LnJlcGxhY2Uoc3R5bGVDb21tZW50UkUsIChtYXRjaCkgPT4gbWF0Y2guc3RhcnRzV2l0aChcIi8qXCIpID8gXCJcIiA6IG1hdGNoKS5zcGxpdChsaXN0RGVsaW1pdGVyUkUpLmZvckVhY2goKGl0ZW0pID0+IHtcbiAgICBpZiAoaXRlbSkge1xuICAgICAgY29uc3QgdG1wID0gaXRlbS5zcGxpdChwcm9wZXJ0eURlbGltaXRlclJFKTtcbiAgICAgIHRtcC5sZW5ndGggPiAxICYmIChyZXRbdG1wWzBdLnRyaW0oKV0gPSB0bXBbMV0udHJpbSgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gcmV0O1xufVxuZnVuY3Rpb24gc3RyaW5naWZ5U3R5bGUoc3R5bGVzKSB7XG4gIGlmICghc3R5bGVzKSByZXR1cm4gXCJcIjtcbiAgaWYgKGlzU3RyaW5nKHN0eWxlcykpIHJldHVybiBzdHlsZXM7XG4gIGxldCByZXQgPSBcIlwiO1xuICBmb3IgKGNvbnN0IGtleSBpbiBzdHlsZXMpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHN0eWxlc1trZXldO1xuICAgIGlmIChpc1N0cmluZyh2YWx1ZSkgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkS2V5ID0ga2V5LnN0YXJ0c1dpdGgoYC0tYCkgPyBrZXkgOiBoeXBoZW5hdGUoa2V5KTtcbiAgICAgIHJldCArPSBgJHtub3JtYWxpemVkS2V5fToke3ZhbHVlfTtgO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmV0O1xufVxuZnVuY3Rpb24gbm9ybWFsaXplQ2xhc3ModmFsdWUpIHtcbiAgbGV0IHJlcyA9IFwiXCI7XG4gIGlmIChpc1N0cmluZyh2YWx1ZSkpIHtcbiAgICByZXMgPSB2YWx1ZTtcbiAgfSBlbHNlIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdmFsdWUubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVDbGFzcyh2YWx1ZVtpXSk7XG4gICAgICBpZiAobm9ybWFsaXplZCkge1xuICAgICAgICByZXMgKz0gbm9ybWFsaXplZCArIFwiIFwiO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgaW4gdmFsdWUpIHtcbiAgICAgIGlmICh2YWx1ZVtuYW1lXSkge1xuICAgICAgICByZXMgKz0gbmFtZSArIFwiIFwiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzLnRyaW0oKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVByb3BzKHByb3BzKSB7XG4gIGlmICghcHJvcHMpIHJldHVybiBudWxsO1xuICBsZXQgeyBjbGFzczoga2xhc3MsIHN0eWxlIH0gPSBwcm9wcztcbiAgaWYgKGtsYXNzICYmICFpc1N0cmluZyhrbGFzcykpIHtcbiAgICBwcm9wcy5jbGFzcyA9IG5vcm1hbGl6ZUNsYXNzKGtsYXNzKTtcbiAgfVxuICBpZiAoc3R5bGUpIHtcbiAgICBwcm9wcy5zdHlsZSA9IG5vcm1hbGl6ZVN0eWxlKHN0eWxlKTtcbiAgfVxuICByZXR1cm4gcHJvcHM7XG59XG5cbmNvbnN0IEhUTUxfVEFHUyA9IFwiaHRtbCxib2R5LGJhc2UsaGVhZCxsaW5rLG1ldGEsc3R5bGUsdGl0bGUsYWRkcmVzcyxhcnRpY2xlLGFzaWRlLGZvb3RlcixoZWFkZXIsaGdyb3VwLGgxLGgyLGgzLGg0LGg1LGg2LG5hdixzZWN0aW9uLGRpdixkZCxkbCxkdCxmaWdjYXB0aW9uLGZpZ3VyZSxwaWN0dXJlLGhyLGltZyxsaSxtYWluLG9sLHAscHJlLHVsLGEsYixhYmJyLGJkaSxiZG8sYnIsY2l0ZSxjb2RlLGRhdGEsZGZuLGVtLGksa2JkLG1hcmsscSxycCxydCxydWJ5LHMsc2FtcCxzbWFsbCxzcGFuLHN0cm9uZyxzdWIsc3VwLHRpbWUsdSx2YXIsd2JyLGFyZWEsYXVkaW8sbWFwLHRyYWNrLHZpZGVvLGVtYmVkLG9iamVjdCxwYXJhbSxzb3VyY2UsY2FudmFzLHNjcmlwdCxub3NjcmlwdCxkZWwsaW5zLGNhcHRpb24sY29sLGNvbGdyb3VwLHRhYmxlLHRoZWFkLHRib2R5LHRkLHRoLHRyLGJ1dHRvbixkYXRhbGlzdCxmaWVsZHNldCxmb3JtLGlucHV0LGxhYmVsLGxlZ2VuZCxtZXRlcixvcHRncm91cCxvcHRpb24sb3V0cHV0LHByb2dyZXNzLHNlbGVjdCx0ZXh0YXJlYSxkZXRhaWxzLGRpYWxvZyxtZW51LHN1bW1hcnksdGVtcGxhdGUsYmxvY2txdW90ZSxpZnJhbWUsdGZvb3RcIjtcbmNvbnN0IFNWR19UQUdTID0gXCJzdmcsYW5pbWF0ZSxhbmltYXRlTW90aW9uLGFuaW1hdGVUcmFuc2Zvcm0sY2lyY2xlLGNsaXBQYXRoLGNvbG9yLXByb2ZpbGUsZGVmcyxkZXNjLGRpc2NhcmQsZWxsaXBzZSxmZUJsZW5kLGZlQ29sb3JNYXRyaXgsZmVDb21wb25lbnRUcmFuc2ZlcixmZUNvbXBvc2l0ZSxmZUNvbnZvbHZlTWF0cml4LGZlRGlmZnVzZUxpZ2h0aW5nLGZlRGlzcGxhY2VtZW50TWFwLGZlRGlzdGFudExpZ2h0LGZlRHJvcFNoYWRvdyxmZUZsb29kLGZlRnVuY0EsZmVGdW5jQixmZUZ1bmNHLGZlRnVuY1IsZmVHYXVzc2lhbkJsdXIsZmVJbWFnZSxmZU1lcmdlLGZlTWVyZ2VOb2RlLGZlTW9ycGhvbG9neSxmZU9mZnNldCxmZVBvaW50TGlnaHQsZmVTcGVjdWxhckxpZ2h0aW5nLGZlU3BvdExpZ2h0LGZlVGlsZSxmZVR1cmJ1bGVuY2UsZmlsdGVyLGZvcmVpZ25PYmplY3QsZyxoYXRjaCxoYXRjaHBhdGgsaW1hZ2UsbGluZSxsaW5lYXJHcmFkaWVudCxtYXJrZXIsbWFzayxtZXNoLG1lc2hncmFkaWVudCxtZXNocGF0Y2gsbWVzaHJvdyxtZXRhZGF0YSxtcGF0aCxwYXRoLHBhdHRlcm4scG9seWdvbixwb2x5bGluZSxyYWRpYWxHcmFkaWVudCxyZWN0LHNldCxzb2xpZGNvbG9yLHN0b3Asc3dpdGNoLHN5bWJvbCx0ZXh0LHRleHRQYXRoLHRpdGxlLHRzcGFuLHVua25vd24sdXNlLHZpZXdcIjtcbmNvbnN0IE1BVEhfVEFHUyA9IFwiYW5ub3RhdGlvbixhbm5vdGF0aW9uLXhtbCxtYWN0aW9uLG1hbGlnbmdyb3VwLG1hbGlnbm1hcmssbWF0aCxtZW5jbG9zZSxtZXJyb3IsbWZlbmNlZCxtZnJhYyxtZnJhY3Rpb24sbWdseXBoLG1pLG1sYWJlbGVkdHIsbWxvbmdkaXYsbW11bHRpc2NyaXB0cyxtbixtbyxtb3ZlcixtcGFkZGVkLG1waGFudG9tLG1wcmVzY3JpcHRzLG1yb290LG1yb3csbXMsbXNjYXJyaWVzLG1zY2FycnksbXNncm91cCxtc2xpbmUsbXNwYWNlLG1zcXJ0LG1zcm93LG1zdGFjayxtc3R5bGUsbXN1Yixtc3Vic3VwLG1zdXAsbXRhYmxlLG10ZCxtdGV4dCxtdHIsbXVuZGVyLG11bmRlcm92ZXIsbm9uZSxzZW1hbnRpY3NcIjtcbmNvbnN0IFZPSURfVEFHUyA9IFwiYXJlYSxiYXNlLGJyLGNvbCxlbWJlZCxocixpbWcsaW5wdXQsbGluayxtZXRhLHBhcmFtLHNvdXJjZSx0cmFjayx3YnJcIjtcbmNvbnN0IGlzSFRNTFRhZyA9IC8qIEBfX1BVUkVfXyAqLyBtYWtlTWFwKEhUTUxfVEFHUyk7XG5jb25zdCBpc1NWR1RhZyA9IC8qIEBfX1BVUkVfXyAqLyBtYWtlTWFwKFNWR19UQUdTKTtcbmNvbnN0IGlzTWF0aE1MVGFnID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoTUFUSF9UQUdTKTtcbmNvbnN0IGlzVm9pZFRhZyA9IC8qIEBfX1BVUkVfXyAqLyBtYWtlTWFwKFZPSURfVEFHUyk7XG5cbmNvbnN0IHNwZWNpYWxCb29sZWFuQXR0cnMgPSBgaXRlbXNjb3BlLGFsbG93ZnVsbHNjcmVlbixmb3Jtbm92YWxpZGF0ZSxpc21hcCxub21vZHVsZSxub3ZhbGlkYXRlLHBsYXlzaW5saW5lLHJlYWRvbmx5YDtcbmNvbnN0IGlzU3BlY2lhbEJvb2xlYW5BdHRyID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoc3BlY2lhbEJvb2xlYW5BdHRycyk7XG5jb25zdCBpc0Jvb2xlYW5BdHRyID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoXG4gIHNwZWNpYWxCb29sZWFuQXR0cnMgKyBgLGFzeW5jLGF1dG9mb2N1cyxhdXRvcGxheSxjb250cm9scyxkZWZhdWx0LGRlZmVyLGRpc2FibGVkLGluZXJ0LGxvb3Asb3BlbixyZXF1aXJlZCxyZXZlcnNlZCxzY29wZWQsc2VhbWxlc3MsY2hlY2tlZCxtdXRlZCxtdWx0aXBsZSxzZWxlY3RlZGBcbik7XG5mdW5jdGlvbiBpbmNsdWRlQm9vbGVhbkF0dHIodmFsdWUpIHtcbiAgcmV0dXJuICEhdmFsdWUgfHwgdmFsdWUgPT09IFwiXCI7XG59XG5jb25zdCB1bnNhZmVBdHRyQ2hhclJFID0gL1s+Lz1cIidcXHUwMDA5XFx1MDAwYVxcdTAwMGNcXHUwMDBkXFx1MDAyMF0vO1xuY29uc3QgYXR0clZhbGlkYXRpb25DYWNoZSA9IHt9O1xuZnVuY3Rpb24gaXNTU1JTYWZlQXR0ck5hbWUobmFtZSkge1xuICBpZiAoYXR0clZhbGlkYXRpb25DYWNoZS5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgIHJldHVybiBhdHRyVmFsaWRhdGlvbkNhY2hlW25hbWVdO1xuICB9XG4gIGNvbnN0IGlzVW5zYWZlID0gdW5zYWZlQXR0ckNoYXJSRS50ZXN0KG5hbWUpO1xuICBpZiAoaXNVbnNhZmUpIHtcbiAgICBjb25zb2xlLmVycm9yKGB1bnNhZmUgYXR0cmlidXRlIG5hbWU6ICR7bmFtZX1gKTtcbiAgfVxuICByZXR1cm4gYXR0clZhbGlkYXRpb25DYWNoZVtuYW1lXSA9ICFpc1Vuc2FmZTtcbn1cbmNvbnN0IHByb3BzVG9BdHRyTWFwID0ge1xuICBhY2NlcHRDaGFyc2V0OiBcImFjY2VwdC1jaGFyc2V0XCIsXG4gIGNsYXNzTmFtZTogXCJjbGFzc1wiLFxuICBodG1sRm9yOiBcImZvclwiLFxuICBodHRwRXF1aXY6IFwiaHR0cC1lcXVpdlwiXG59O1xuY29uc3QgaXNLbm93bkh0bWxBdHRyID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoXG4gIGBhY2NlcHQsYWNjZXB0LWNoYXJzZXQsYWNjZXNza2V5LGFjdGlvbixhbGlnbixhbGxvdyxhbHQsYXN5bmMsYXV0b2NhcGl0YWxpemUsYXV0b2NvbXBsZXRlLGF1dG9mb2N1cyxhdXRvcGxheSxiYWNrZ3JvdW5kLGJnY29sb3IsYm9yZGVyLGJ1ZmZlcmVkLGNhcHR1cmUsY2hhbGxlbmdlLGNoYXJzZXQsY2hlY2tlZCxjaXRlLGNsYXNzLGNvZGUsY29kZWJhc2UsY29sb3IsY29scyxjb2xzcGFuLGNvbnRlbnQsY29udGVudGVkaXRhYmxlLGNvbnRleHRtZW51LGNvbnRyb2xzLGNvb3Jkcyxjcm9zc29yaWdpbixjc3AsZGF0YSxkYXRldGltZSxkZWNvZGluZyxkZWZhdWx0LGRlZmVyLGRpcixkaXJuYW1lLGRpc2FibGVkLGRvd25sb2FkLGRyYWdnYWJsZSxkcm9wem9uZSxlbmN0eXBlLGVudGVya2V5aGludCxmb3IsZm9ybSxmb3JtYWN0aW9uLGZvcm1lbmN0eXBlLGZvcm1tZXRob2QsZm9ybW5vdmFsaWRhdGUsZm9ybXRhcmdldCxoZWFkZXJzLGhlaWdodCxoaWRkZW4saGlnaCxocmVmLGhyZWZsYW5nLGh0dHAtZXF1aXYsaWNvbixpZCxpbXBvcnRhbmNlLGluZXJ0LGludGVncml0eSxpc21hcCxpdGVtcHJvcCxrZXl0eXBlLGtpbmQsbGFiZWwsbGFuZyxsYW5ndWFnZSxsb2FkaW5nLGxpc3QsbG9vcCxsb3csbWFuaWZlc3QsbWF4LG1heGxlbmd0aCxtaW5sZW5ndGgsbWVkaWEsbWluLG11bHRpcGxlLG11dGVkLG5hbWUsbm92YWxpZGF0ZSxvcGVuLG9wdGltdW0scGF0dGVybixwaW5nLHBsYWNlaG9sZGVyLHBvc3RlcixwcmVsb2FkLHJhZGlvZ3JvdXAscmVhZG9ubHkscmVmZXJyZXJwb2xpY3kscmVsLHJlcXVpcmVkLHJldmVyc2VkLHJvd3Mscm93c3BhbixzYW5kYm94LHNjb3BlLHNjb3BlZCxzZWxlY3RlZCxzaGFwZSxzaXplLHNpemVzLHNsb3Qsc3BhbixzcGVsbGNoZWNrLHNyYyxzcmNkb2Msc3JjbGFuZyxzcmNzZXQsc3RhcnQsc3RlcCxzdHlsZSxzdW1tYXJ5LHRhYmluZGV4LHRhcmdldCx0aXRsZSx0cmFuc2xhdGUsdHlwZSx1c2VtYXAsdmFsdWUsd2lkdGgsd3JhcGBcbik7XG5jb25zdCBpc0tub3duU3ZnQXR0ciA9IC8qIEBfX1BVUkVfXyAqLyBtYWtlTWFwKFxuICBgeG1sbnMsYWNjZW50LWhlaWdodCxhY2N1bXVsYXRlLGFkZGl0aXZlLGFsaWdubWVudC1iYXNlbGluZSxhbHBoYWJldGljLGFtcGxpdHVkZSxhcmFiaWMtZm9ybSxhc2NlbnQsYXR0cmlidXRlTmFtZSxhdHRyaWJ1dGVUeXBlLGF6aW11dGgsYmFzZUZyZXF1ZW5jeSxiYXNlbGluZS1zaGlmdCxiYXNlUHJvZmlsZSxiYm94LGJlZ2luLGJpYXMsYnksY2FsY01vZGUsY2FwLWhlaWdodCxjbGFzcyxjbGlwLGNsaXBQYXRoVW5pdHMsY2xpcC1wYXRoLGNsaXAtcnVsZSxjb2xvcixjb2xvci1pbnRlcnBvbGF0aW9uLGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycyxjb2xvci1wcm9maWxlLGNvbG9yLXJlbmRlcmluZyxjb250ZW50U2NyaXB0VHlwZSxjb250ZW50U3R5bGVUeXBlLGNyb3Nzb3JpZ2luLGN1cnNvcixjeCxjeSxkLGRlY2VsZXJhdGUsZGVzY2VudCxkaWZmdXNlQ29uc3RhbnQsZGlyZWN0aW9uLGRpc3BsYXksZGl2aXNvcixkb21pbmFudC1iYXNlbGluZSxkdXIsZHgsZHksZWRnZU1vZGUsZWxldmF0aW9uLGVuYWJsZS1iYWNrZ3JvdW5kLGVuZCxleHBvbmVudCxmaWxsLGZpbGwtb3BhY2l0eSxmaWxsLXJ1bGUsZmlsdGVyLGZpbHRlclJlcyxmaWx0ZXJVbml0cyxmbG9vZC1jb2xvcixmbG9vZC1vcGFjaXR5LGZvbnQtZmFtaWx5LGZvbnQtc2l6ZSxmb250LXNpemUtYWRqdXN0LGZvbnQtc3RyZXRjaCxmb250LXN0eWxlLGZvbnQtdmFyaWFudCxmb250LXdlaWdodCxmb3JtYXQsZnJvbSxmcixmeCxmeSxnMSxnMixnbHlwaC1uYW1lLGdseXBoLW9yaWVudGF0aW9uLWhvcml6b250YWwsZ2x5cGgtb3JpZW50YXRpb24tdmVydGljYWwsZ2x5cGhSZWYsZ3JhZGllbnRUcmFuc2Zvcm0sZ3JhZGllbnRVbml0cyxoYW5naW5nLGhlaWdodCxocmVmLGhyZWZsYW5nLGhvcml6LWFkdi14LGhvcml6LW9yaWdpbi14LGlkLGlkZW9ncmFwaGljLGltYWdlLXJlbmRlcmluZyxpbixpbjIsaW50ZXJjZXB0LGssazEsazIsazMsazQsa2VybmVsTWF0cml4LGtlcm5lbFVuaXRMZW5ndGgsa2VybmluZyxrZXlQb2ludHMsa2V5U3BsaW5lcyxrZXlUaW1lcyxsYW5nLGxlbmd0aEFkanVzdCxsZXR0ZXItc3BhY2luZyxsaWdodGluZy1jb2xvcixsaW1pdGluZ0NvbmVBbmdsZSxsb2NhbCxtYXJrZXItZW5kLG1hcmtlci1taWQsbWFya2VyLXN0YXJ0LG1hcmtlckhlaWdodCxtYXJrZXJVbml0cyxtYXJrZXJXaWR0aCxtYXNrLG1hc2tDb250ZW50VW5pdHMsbWFza1VuaXRzLG1hdGhlbWF0aWNhbCxtYXgsbWVkaWEsbWV0aG9kLG1pbixtb2RlLG5hbWUsbnVtT2N0YXZlcyxvZmZzZXQsb3BhY2l0eSxvcGVyYXRvcixvcmRlcixvcmllbnQsb3JpZW50YXRpb24sb3JpZ2luLG92ZXJmbG93LG92ZXJsaW5lLXBvc2l0aW9uLG92ZXJsaW5lLXRoaWNrbmVzcyxwYW5vc2UtMSxwYWludC1vcmRlcixwYXRoLHBhdGhMZW5ndGgscGF0dGVybkNvbnRlbnRVbml0cyxwYXR0ZXJuVHJhbnNmb3JtLHBhdHRlcm5Vbml0cyxwaW5nLHBvaW50ZXItZXZlbnRzLHBvaW50cyxwb2ludHNBdFgscG9pbnRzQXRZLHBvaW50c0F0WixwcmVzZXJ2ZUFscGhhLHByZXNlcnZlQXNwZWN0UmF0aW8scHJpbWl0aXZlVW5pdHMscixyYWRpdXMscmVmZXJyZXJQb2xpY3kscmVmWCxyZWZZLHJlbCxyZW5kZXJpbmctaW50ZW50LHJlcGVhdENvdW50LHJlcGVhdER1cixyZXF1aXJlZEV4dGVuc2lvbnMscmVxdWlyZWRGZWF0dXJlcyxyZXN0YXJ0LHJlc3VsdCxyb3RhdGUscngscnksc2NhbGUsc2VlZCxzaGFwZS1yZW5kZXJpbmcsc2xvcGUsc3BhY2luZyxzcGVjdWxhckNvbnN0YW50LHNwZWN1bGFyRXhwb25lbnQsc3BlZWQsc3ByZWFkTWV0aG9kLHN0YXJ0T2Zmc2V0LHN0ZERldmlhdGlvbixzdGVtaCxzdGVtdixzdGl0Y2hUaWxlcyxzdG9wLWNvbG9yLHN0b3Atb3BhY2l0eSxzdHJpa2V0aHJvdWdoLXBvc2l0aW9uLHN0cmlrZXRocm91Z2gtdGhpY2tuZXNzLHN0cmluZyxzdHJva2Usc3Ryb2tlLWRhc2hhcnJheSxzdHJva2UtZGFzaG9mZnNldCxzdHJva2UtbGluZWNhcCxzdHJva2UtbGluZWpvaW4sc3Ryb2tlLW1pdGVybGltaXQsc3Ryb2tlLW9wYWNpdHksc3Ryb2tlLXdpZHRoLHN0eWxlLHN1cmZhY2VTY2FsZSxzeXN0ZW1MYW5ndWFnZSx0YWJpbmRleCx0YWJsZVZhbHVlcyx0YXJnZXQsdGFyZ2V0WCx0YXJnZXRZLHRleHQtYW5jaG9yLHRleHQtZGVjb3JhdGlvbix0ZXh0LXJlbmRlcmluZyx0ZXh0TGVuZ3RoLHRvLHRyYW5zZm9ybSx0cmFuc2Zvcm0tb3JpZ2luLHR5cGUsdTEsdTIsdW5kZXJsaW5lLXBvc2l0aW9uLHVuZGVybGluZS10aGlja25lc3MsdW5pY29kZSx1bmljb2RlLWJpZGksdW5pY29kZS1yYW5nZSx1bml0cy1wZXItZW0sdi1hbHBoYWJldGljLHYtaGFuZ2luZyx2LWlkZW9ncmFwaGljLHYtbWF0aGVtYXRpY2FsLHZhbHVlcyx2ZWN0b3ItZWZmZWN0LHZlcnNpb24sdmVydC1hZHYteSx2ZXJ0LW9yaWdpbi14LHZlcnQtb3JpZ2luLXksdmlld0JveCx2aWV3VGFyZ2V0LHZpc2liaWxpdHksd2lkdGgsd2lkdGhzLHdvcmQtc3BhY2luZyx3cml0aW5nLW1vZGUseCx4LWhlaWdodCx4MSx4Mix4Q2hhbm5lbFNlbGVjdG9yLHhsaW5rOmFjdHVhdGUseGxpbms6YXJjcm9sZSx4bGluazpocmVmLHhsaW5rOnJvbGUseGxpbms6c2hvdyx4bGluazp0aXRsZSx4bGluazp0eXBlLHhtbG5zOnhsaW5rLHhtbDpiYXNlLHhtbDpsYW5nLHhtbDpzcGFjZSx5LHkxLHkyLHlDaGFubmVsU2VsZWN0b3Iseix6b29tQW5kUGFuYFxuKTtcbmNvbnN0IGlzS25vd25NYXRoTUxBdHRyID0gLyogQF9fUFVSRV9fICovIG1ha2VNYXAoXG4gIGBhY2NlbnQsYWNjZW50dW5kZXIsYWN0aW9udHlwZSxhbGlnbixhbGlnbm1lbnRzY29wZSxhbHRpbWcsYWx0aW1nLWhlaWdodCxhbHRpbWctdmFsaWduLGFsdGltZy13aWR0aCxhbHR0ZXh0LGJldmVsbGVkLGNsb3NlLGNvbHVtbnNhbGlnbixjb2x1bW5saW5lcyxjb2x1bW5zcGFuLGRlbm9tYWxpZ24sZGVwdGgsZGlyLGRpc3BsYXksZGlzcGxheXN0eWxlLGVuY29kaW5nLGVxdWFsY29sdW1ucyxlcXVhbHJvd3MsZmVuY2UsZm9udHN0eWxlLGZvbnR3ZWlnaHQsZm9ybSxmcmFtZSxmcmFtZXNwYWNpbmcsZ3JvdXBhbGlnbixoZWlnaHQsaHJlZixpZCxpbmRlbnRhbGlnbixpbmRlbnRhbGlnbmZpcnN0LGluZGVudGFsaWdubGFzdCxpbmRlbnRzaGlmdCxpbmRlbnRzaGlmdGZpcnN0LGluZGVudHNoaWZ0bGFzdCxpbmRleHR5cGUsanVzdGlmeSxsYXJnZXRvcCxsYXJnZW9wLGxxdW90ZSxsc3BhY2UsbWF0aGJhY2tncm91bmQsbWF0aGNvbG9yLG1hdGhzaXplLG1hdGh2YXJpYW50LG1heHNpemUsbWlubGFiZWxzcGFjaW5nLG1vZGUsb3RoZXIsb3ZlcmZsb3cscG9zaXRpb24scm93YWxpZ24scm93bGluZXMscm93c3BhbixycXVvdGUscnNwYWNlLHNjcmlwdGxldmVsLHNjcmlwdG1pbnNpemUsc2NyaXB0c2l6ZW11bHRpcGxpZXIsc2VsZWN0aW9uLHNlcGFyYXRvcixzZXBhcmF0b3JzLHNoaWZ0LHNpZGUsc3JjLHN0YWNrYWxpZ24sc3RyZXRjaHksc3Vic2NyaXB0c2hpZnQsc3VwZXJzY3JpcHRzaGlmdCxzeW1tZXRyaWMsdm9mZnNldCx3aWR0aCx3aWR0aHMseGxpbms6aHJlZix4bGluazpzaG93LHhsaW5rOnR5cGUseG1sbnNgXG4pO1xuZnVuY3Rpb24gaXNSZW5kZXJhYmxlQXR0clZhbHVlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IHR5cGUgPSB0eXBlb2YgdmFsdWU7XG4gIHJldHVybiB0eXBlID09PSBcInN0cmluZ1wiIHx8IHR5cGUgPT09IFwibnVtYmVyXCIgfHwgdHlwZSA9PT0gXCJib29sZWFuXCI7XG59XG5cbmNvbnN0IGVzY2FwZVJFID0gL1tcIicmPD5dLztcbmZ1bmN0aW9uIGVzY2FwZUh0bWwoc3RyaW5nKSB7XG4gIGNvbnN0IHN0ciA9IFwiXCIgKyBzdHJpbmc7XG4gIGNvbnN0IG1hdGNoID0gZXNjYXBlUkUuZXhlYyhzdHIpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxuICBsZXQgaHRtbCA9IFwiXCI7XG4gIGxldCBlc2NhcGVkO1xuICBsZXQgaW5kZXg7XG4gIGxldCBsYXN0SW5kZXggPSAwO1xuICBmb3IgKGluZGV4ID0gbWF0Y2guaW5kZXg7IGluZGV4IDwgc3RyLmxlbmd0aDsgaW5kZXgrKykge1xuICAgIHN3aXRjaCAoc3RyLmNoYXJDb2RlQXQoaW5kZXgpKSB7XG4gICAgICBjYXNlIDM0OlxuICAgICAgICBlc2NhcGVkID0gXCImcXVvdDtcIjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM4OlxuICAgICAgICBlc2NhcGVkID0gXCImYW1wO1wiO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzk6XG4gICAgICAgIGVzY2FwZWQgPSBcIiYjMzk7XCI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSA2MDpcbiAgICAgICAgZXNjYXBlZCA9IFwiJmx0O1wiO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgNjI6XG4gICAgICAgIGVzY2FwZWQgPSBcIiZndDtcIjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxhc3RJbmRleCAhPT0gaW5kZXgpIHtcbiAgICAgIGh0bWwgKz0gc3RyLnNsaWNlKGxhc3RJbmRleCwgaW5kZXgpO1xuICAgIH1cbiAgICBsYXN0SW5kZXggPSBpbmRleCArIDE7XG4gICAgaHRtbCArPSBlc2NhcGVkO1xuICB9XG4gIHJldHVybiBsYXN0SW5kZXggIT09IGluZGV4ID8gaHRtbCArIHN0ci5zbGljZShsYXN0SW5kZXgsIGluZGV4KSA6IGh0bWw7XG59XG5jb25zdCBjb21tZW50U3RyaXBSRSA9IC9eKD86LT8+KSt8PCEtLXwtLT58LS0hPnw8IS0kL2c7XG5mdW5jdGlvbiBlc2NhcGVIdG1sQ29tbWVudChzcmMpIHtcbiAgbGV0IHByZXY7XG4gIGRvIHtcbiAgICBwcmV2ID0gc3JjO1xuICAgIHNyYyA9IHNyYy5yZXBsYWNlKGNvbW1lbnRTdHJpcFJFLCBcIlwiKTtcbiAgfSB3aGlsZSAoc3JjICE9PSBwcmV2KTtcbiAgcmV0dXJuIHNyYztcbn1cbmNvbnN0IGNzc1Zhck5hbWVFc2NhcGVTeW1ib2xzUkUgPSAvWyAhXCIjJCUmJygpKissLi86Ozw9Pj9AW1xcXFxcXF1eYHt8fX5dL2c7XG5mdW5jdGlvbiBnZXRFc2NhcGVkQ3NzVmFyTmFtZShrZXksIGRvdWJsZUVzY2FwZSkge1xuICByZXR1cm4ga2V5LnJlcGxhY2UoXG4gICAgY3NzVmFyTmFtZUVzY2FwZVN5bWJvbHNSRSxcbiAgICAocykgPT4gZG91YmxlRXNjYXBlID8gcyA9PT0gJ1wiJyA/ICdcXFxcXFxcXFxcXFxcIicgOiBgXFxcXFxcXFwke3N9YCA6IGBcXFxcJHtzfWBcbiAgKTtcbn1cblxuZnVuY3Rpb24gbG9vc2VDb21wYXJlQXJyYXlzKGEsIGIsIHNlZW4pIHtcbiAgaWYgKGEubGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICBsZXQgZXF1YWwgPSB0cnVlO1xuICBmb3IgKGxldCBpID0gMDsgZXF1YWwgJiYgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICBlcXVhbCA9IGxvb3NlRXF1YWwoYVtpXSwgYltpXSwgc2Vlbik7XG4gIH1cbiAgcmV0dXJuIGVxdWFsO1xufVxuZnVuY3Rpb24gbG9vc2VDb21wYXJlQ29sbGVjdGlvbnMoYSwgYiwgc2Vlbikge1xuICBpZiAoYS5zaXplICE9PSBiLnNpemUpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IEFycmF5LmZyb20oYik7XG4gIGNvbnN0IG1hdGNoZWQgPSBuZXcgVWludDhBcnJheShjYW5kaWRhdGVzLmxlbmd0aCk7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBhKSB7XG4gICAgbGV0IGluZGV4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYW5kaWRhdGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoIW1hdGNoZWRbaV0gJiYgbG9vc2VFcXVhbChpdGVtLCBjYW5kaWRhdGVzW2ldLCBzZWVuKSkge1xuICAgICAgICBpbmRleCA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaW5kZXggPCAwKSByZXR1cm4gZmFsc2U7XG4gICAgbWF0Y2hlZFtpbmRleF0gPSAxO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuZnVuY3Rpb24gbG9vc2VDb21wYXJlT2JqZWN0cyhhLCBiLCBzZWVuKSB7XG4gIGxldCBhVmFsaWRUeXBlID0gaXNNYXAoYSk7XG4gIGxldCBiVmFsaWRUeXBlID0gaXNNYXAoYik7XG4gIGlmIChhVmFsaWRUeXBlIHx8IGJWYWxpZFR5cGUpIHtcbiAgICByZXR1cm4gYVZhbGlkVHlwZSAmJiBiVmFsaWRUeXBlID8gbG9vc2VDb21wYXJlQ29sbGVjdGlvbnMoYSwgYiwgc2VlbikgOiBmYWxzZTtcbiAgfVxuICBhVmFsaWRUeXBlID0gaXNTZXQoYSk7XG4gIGJWYWxpZFR5cGUgPSBpc1NldChiKTtcbiAgaWYgKGFWYWxpZFR5cGUgfHwgYlZhbGlkVHlwZSkge1xuICAgIHJldHVybiBhVmFsaWRUeXBlICYmIGJWYWxpZFR5cGUgPyBsb29zZUNvbXBhcmVDb2xsZWN0aW9ucyhhLCBiLCBzZWVuKSA6IGZhbHNlO1xuICB9XG4gIGNvbnN0IGFLZXlzQ291bnQgPSBPYmplY3Qua2V5cyhhKS5sZW5ndGg7XG4gIGNvbnN0IGJLZXlzQ291bnQgPSBPYmplY3Qua2V5cyhiKS5sZW5ndGg7XG4gIGlmIChhS2V5c0NvdW50ICE9PSBiS2V5c0NvdW50KSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGZvciAoY29uc3Qga2V5IGluIGEpIHtcbiAgICBjb25zdCBhSGFzS2V5ID0gYS5oYXNPd25Qcm9wZXJ0eShrZXkpO1xuICAgIGNvbnN0IGJIYXNLZXkgPSBiLmhhc093blByb3BlcnR5KGtleSk7XG4gICAgaWYgKGFIYXNLZXkgJiYgIWJIYXNLZXkgfHwgIWFIYXNLZXkgJiYgYkhhc0tleSB8fCAhbG9vc2VFcXVhbChhW2tleV0sIGJba2V5XSwgc2VlbikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFN0cmluZyhhKSA9PT0gU3RyaW5nKGIpO1xufVxuZnVuY3Rpb24gbG9vc2VDb21wYXJlTmVzdGVkKGEsIGIsIHNlZW4sIGNvbXBhcmUpIHtcbiAgaWYgKCFzZWVuKSB7XG4gICAgc2VlbiA9IFsvKiBAX19QVVJFX18gKi8gbmV3IE1hcCgpLCAvKiBAX19QVVJFX18gKi8gbmV3IE1hcCgpXTtcbiAgfVxuICBjb25zdCBbc2VlbkEsIHNlZW5CXSA9IHNlZW47XG4gIGlmIChzZWVuQS5oYXMoYSkgfHwgc2VlbkIuaGFzKGIpKSB7XG4gICAgcmV0dXJuIHNlZW5BLmdldChhKSA9PT0gYiAmJiBzZWVuQi5nZXQoYikgPT09IGE7XG4gIH1cbiAgc2VlbkEuc2V0KGEsIGIpO1xuICBzZWVuQi5zZXQoYiwgYSk7XG4gIGNvbnN0IGVxdWFsID0gY29tcGFyZShhLCBiLCBzZWVuKTtcbiAgc2VlbkEuZGVsZXRlKGEpO1xuICBzZWVuQi5kZWxldGUoYik7XG4gIHJldHVybiBlcXVhbDtcbn1cbmZ1bmN0aW9uIGxvb3NlRXF1YWwoYSwgYiwgc2Vlbikge1xuICBpZiAoYSA9PT0gYikgcmV0dXJuIHRydWU7XG4gIGxldCBhVmFsaWRUeXBlID0gaXNEYXRlKGEpO1xuICBsZXQgYlZhbGlkVHlwZSA9IGlzRGF0ZShiKTtcbiAgaWYgKGFWYWxpZFR5cGUgfHwgYlZhbGlkVHlwZSkge1xuICAgIHJldHVybiBhVmFsaWRUeXBlICYmIGJWYWxpZFR5cGUgPyBhLmdldFRpbWUoKSA9PT0gYi5nZXRUaW1lKCkgOiBmYWxzZTtcbiAgfVxuICBhVmFsaWRUeXBlID0gaXNTeW1ib2woYSk7XG4gIGJWYWxpZFR5cGUgPSBpc1N5bWJvbChiKTtcbiAgaWYgKGFWYWxpZFR5cGUgfHwgYlZhbGlkVHlwZSkge1xuICAgIHJldHVybiBhID09PSBiO1xuICB9XG4gIGFWYWxpZFR5cGUgPSBpc0FycmF5KGEpO1xuICBiVmFsaWRUeXBlID0gaXNBcnJheShiKTtcbiAgaWYgKGFWYWxpZFR5cGUgfHwgYlZhbGlkVHlwZSkge1xuICAgIHJldHVybiBhVmFsaWRUeXBlICYmIGJWYWxpZFR5cGUgPyBsb29zZUNvbXBhcmVOZXN0ZWQoYSwgYiwgc2VlbiwgbG9vc2VDb21wYXJlQXJyYXlzKSA6IGZhbHNlO1xuICB9XG4gIGFWYWxpZFR5cGUgPSBpc09iamVjdChhKTtcbiAgYlZhbGlkVHlwZSA9IGlzT2JqZWN0KGIpO1xuICBpZiAoYVZhbGlkVHlwZSB8fCBiVmFsaWRUeXBlKSB7XG4gICAgaWYgKCFhVmFsaWRUeXBlIHx8ICFiVmFsaWRUeXBlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBsb29zZUNvbXBhcmVOZXN0ZWQoYSwgYiwgc2VlbiwgbG9vc2VDb21wYXJlT2JqZWN0cyk7XG4gIH1cbiAgcmV0dXJuIFN0cmluZyhhKSA9PT0gU3RyaW5nKGIpO1xufVxuZnVuY3Rpb24gbG9vc2VJbmRleE9mKGFyciwgdmFsKSB7XG4gIHJldHVybiBhcnIuZmluZEluZGV4KChpdGVtKSA9PiBsb29zZUVxdWFsKGl0ZW0sIHZhbCkpO1xufVxuXG5jb25zdCBpc1JlZiA9ICh2YWwpID0+IHtcbiAgcmV0dXJuICEhKHZhbCAmJiB2YWxbXCJfX3ZfaXNSZWZcIl0gPT09IHRydWUpO1xufTtcbmNvbnN0IHRvRGlzcGxheVN0cmluZyA9ICh2YWwpID0+IHtcbiAgcmV0dXJuIGlzU3RyaW5nKHZhbCkgPyB2YWwgOiB2YWwgPT0gbnVsbCA/IFwiXCIgOiBpc0FycmF5KHZhbCkgfHwgaXNPYmplY3QodmFsKSAmJiAodmFsLnRvU3RyaW5nID09PSBvYmplY3RUb1N0cmluZyB8fCAhaXNGdW5jdGlvbih2YWwudG9TdHJpbmcpKSA/IGlzUmVmKHZhbCkgPyB0b0Rpc3BsYXlTdHJpbmcodmFsLnZhbHVlKSA6IEpTT04uc3RyaW5naWZ5KHZhbCwgcmVwbGFjZXIsIDIpIDogU3RyaW5nKHZhbCk7XG59O1xuY29uc3QgcmVwbGFjZXIgPSAoX2tleSwgdmFsKSA9PiB7XG4gIGlmIChpc1JlZih2YWwpKSB7XG4gICAgcmV0dXJuIHJlcGxhY2VyKF9rZXksIHZhbC52YWx1ZSk7XG4gIH0gZWxzZSBpZiAoaXNNYXAodmFsKSkge1xuICAgIHJldHVybiB7XG4gICAgICBbYE1hcCgke3ZhbC5zaXplfSlgXTogWy4uLnZhbC5lbnRyaWVzKCldLnJlZHVjZShcbiAgICAgICAgKGVudHJpZXMsIFtrZXksIHZhbDJdLCBpKSA9PiB7XG4gICAgICAgICAgZW50cmllc1tzdHJpbmdpZnlTeW1ib2woa2V5LCBpKSArIFwiID0+XCJdID0gdmFsMjtcbiAgICAgICAgICByZXR1cm4gZW50cmllcztcbiAgICAgICAgfSxcbiAgICAgICAge31cbiAgICAgIClcbiAgICB9O1xuICB9IGVsc2UgaWYgKGlzU2V0KHZhbCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgW2BTZXQoJHt2YWwuc2l6ZX0pYF06IFsuLi52YWwudmFsdWVzKCldLm1hcCgodikgPT4gc3RyaW5naWZ5U3ltYm9sKHYpKVxuICAgIH07XG4gIH0gZWxzZSBpZiAoaXNTeW1ib2wodmFsKSkge1xuICAgIHJldHVybiBzdHJpbmdpZnlTeW1ib2wodmFsKTtcbiAgfSBlbHNlIGlmIChpc09iamVjdCh2YWwpICYmICFpc0FycmF5KHZhbCkgJiYgIWlzUGxhaW5PYmplY3QodmFsKSkge1xuICAgIHJldHVybiBTdHJpbmcodmFsKTtcbiAgfVxuICByZXR1cm4gdmFsO1xufTtcbmNvbnN0IHN0cmluZ2lmeVN5bWJvbCA9ICh2LCBpID0gXCJcIikgPT4ge1xuICB2YXIgX2E7XG4gIHJldHVybiAoXG4gICAgLy8gU3ltYm9sLmRlc2NyaXB0aW9uIGluIGVzMjAxOSsgc28gd2UgbmVlZCB0byBjYXN0IGhlcmUgdG8gcGFzc1xuICAgIC8vIHRoZSBsaWI6IGVzMjAxNiBjaGVja1xuICAgIGlzU3ltYm9sKHYpID8gYFN5bWJvbCgkeyhfYSA9IHYuZGVzY3JpcHRpb24pICE9IG51bGwgPyBfYSA6IGl9KWAgOiB2XG4gICk7XG59O1xuXG5mdW5jdGlvbiBub3JtYWxpemVDc3NWYXJWYWx1ZSh2YWx1ZSkge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiBcImluaXRpYWxcIjtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHZhbHVlID09PSBcIlwiID8gXCIgXCIgOiB2YWx1ZTtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSB7XG4gICAgaWYgKCEhKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIikpIHtcbiAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgXCJbVnVlIHdhcm5dIEludmFsaWQgdmFsdWUgdXNlZCBmb3IgQ1NTIGJpbmRpbmcuIEV4cGVjdGVkIGEgc3RyaW5nIG9yIGEgZmluaXRlIG51bWJlciBidXQgcmVjZWl2ZWQ6XCIsXG4gICAgICAgIHZhbHVlXG4gICAgICApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbn1cblxuZXhwb3J0IHsgRU1QVFlfQVJSLCBFTVBUWV9PQkosIE5PLCBOT09QLCBQYXRjaEZsYWdOYW1lcywgUGF0Y2hGbGFncywgU2hhcGVGbGFncywgU2xvdEZsYWdzLCBjYW1lbGl6ZSwgY2FwaXRhbGl6ZSwgY3NzVmFyTmFtZUVzY2FwZVN5bWJvbHNSRSwgZGVmLCBlc2NhcGVIdG1sLCBlc2NhcGVIdG1sQ29tbWVudCwgZXh0ZW5kLCBnZW5DYWNoZUtleSwgZ2VuUHJvcHNBY2Nlc3NFeHAsIGdlbmVyYXRlQ29kZUZyYW1lLCBnZXRFc2NhcGVkQ3NzVmFyTmFtZSwgZ2V0R2xvYmFsVGhpcywgaGFzQ2hhbmdlZCwgaGFzT3duLCBoeXBoZW5hdGUsIGluY2x1ZGVCb29sZWFuQXR0ciwgaW52b2tlQXJyYXlGbnMsIGlzQXJyYXksIGlzQm9vbGVhbkF0dHIsIGlzQnVpbHRJbkRpcmVjdGl2ZSwgaXNEYXRlLCBpc0Z1bmN0aW9uLCBpc0dsb2JhbGx5QWxsb3dlZCwgaXNHbG9iYWxseVdoaXRlbGlzdGVkLCBpc0hUTUxUYWcsIGlzSW50ZWdlcktleSwgaXNLbm93bkh0bWxBdHRyLCBpc0tub3duTWF0aE1MQXR0ciwgaXNLbm93blN2Z0F0dHIsIGlzTWFwLCBpc01hdGhNTFRhZywgaXNNb2RlbExpc3RlbmVyLCBpc09iamVjdCwgaXNPbiwgaXNQbGFpbk9iamVjdCwgaXNQcm9taXNlLCBpc1JlZ0V4cCwgaXNSZW5kZXJhYmxlQXR0clZhbHVlLCBpc1Jlc2VydmVkUHJvcCwgaXNTU1JTYWZlQXR0ck5hbWUsIGlzU1ZHVGFnLCBpc1NldCwgaXNTcGVjaWFsQm9vbGVhbkF0dHIsIGlzU3RyaW5nLCBpc1N5bWJvbCwgaXNWb2lkVGFnLCBsb29zZUVxdWFsLCBsb29zZUluZGV4T2YsIGxvb3NlVG9OdW1iZXIsIG1ha2VNYXAsIG5vcm1hbGl6ZUNsYXNzLCBub3JtYWxpemVDc3NWYXJWYWx1ZSwgbm9ybWFsaXplUHJvcHMsIG5vcm1hbGl6ZVN0eWxlLCBvYmplY3RUb1N0cmluZywgcGFyc2VTdHJpbmdTdHlsZSwgcHJvcHNUb0F0dHJNYXAsIHJlbW92ZSwgc2xvdEZsYWdzVGV4dCwgc3RyaW5naWZ5U3R5bGUsIHRvRGlzcGxheVN0cmluZywgdG9IYW5kbGVyS2V5LCB0b051bWJlciwgdG9SYXdUeXBlLCB0b1R5cGVTdHJpbmcgfTtcbiJdLCJtYXBwaW5ncyI6IkFBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBTUEsU0FBUyxRQUFRLEtBQUs7QUFDcEIsUUFBTSxNQUFzQix1QkFBTyxPQUFPLElBQUk7QUFDOUMsYUFBVyxPQUFPLElBQUksTUFBTSxHQUFHO0FBQUcsUUFBSSxHQUFHLElBQUk7QUFDN0MsU0FBTyxDQUFDLFFBQVEsT0FBTztBQUN6QjtBQUVBLE1BQU0sWUFBWSxPQUE0QyxPQUFPLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQztBQUNuRixNQUFNLFlBQVksT0FBNEMsT0FBTyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDbkYsTUFBTSxPQUFPLE1BQU07QUFDbkI7QUFDQSxNQUFNLEtBQUssTUFBTTtBQUNqQixNQUFNLE9BQU8sQ0FBQyxRQUFRLElBQUksV0FBVyxDQUFDLE1BQU0sT0FBTyxJQUFJLFdBQVcsQ0FBQyxNQUFNO0FBQUEsQ0FDeEUsSUFBSSxXQUFXLENBQUMsSUFBSSxPQUFPLElBQUksV0FBVyxDQUFDLElBQUk7QUFDaEQsTUFBTSxrQkFBa0IsQ0FBQyxRQUFRLElBQUksV0FBVyxXQUFXO0FB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QUFBLE1BQ0wsQ0FBQyxPQUFPLElBQUksSUFBSSxHQUFHLEdBQUcsQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sZ0JBQWdCLENBQUMsQ0FBQztBQUFBLElBQ3ZFO0FBQUEsRUFDRixXQUFXLFNBQVMsR0FBRyxHQUFHO0FBQ3hCLFdBQU8sZ0JBQWdCLEdBQUc7QUFBQSxFQUM1QixXQUFXLFNBQVMsR0FBRyxLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxjQUFjLEdBQUcsR0FBRztBQUNoRSxXQUFPLE9BQU8sR0FBRztBQUFBLEVBQ25CO0FBQ0EsU0FBTztBQUNUO0FBQ0EsTUFBTSxrQkFBa0IsQ0FBQyxHQUFHLElBQUksT0FBTztBQUNyQyxNQUFJO0FBQ0o7QUFBQTtBQUFBO0FBQUEsSUFHRSxTQUFTLENBQUMsSUFBSSxXQUFXLEtBQUssRUFBRSxnQkFBZ0IsT0FBTyxLQUFLLENBQUMsTUFBTTtBQUFBO0FBRXZFO0FBRUEsU0FBUyxxQkFBcUIsT0FBTztBQUNuQyxNQUFJLFNBQVMsTUFBTTtBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksT0FBTyxVQUFVLFVBQVU7QUFDN0IsV0FBTyxVQUFVLEtBQUssTUFBTTtBQUFBLEVBQzlCO0FBQ0EsTUFBSSxPQUFPLFVBQVUsWUFBWSxDQUFDLE9BQU8sU0FBUyxLQUFLLEdBQUc7QUFDeEQsUUFBSSxNQUEyQztBQUM3QyxjQUFRO0FBQUEsUUFDTjtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLE9BQU8sS0FBSztBQUNyQjtBQUVBLFNBQVMsV0FBVyxXQUFXLElBQUksTUFBTSxnQkFBZ0IsWUFBWSxZQUFZLFdBQVcsVUFBVSxZQUFZLDJCQUEyQixLQUFLLFlBQVksbUJBQW1CLFFBQVEsYUFBYSxtQkFBbUIsbUJBQW1CLHNCQUFzQixlQUFlLFlBQVksUUFBUSxXQUFXLG9CQUFvQixnQkFBZ0IsU0FBUyxlQUFlLG9CQUFvQixRQUFRLFlBQVksbUJBQW1CLHVCQUF1QixXQUFXLGNBQWMsaUJBQWlCLG1CQUFtQixnQkFBZ0IsT0FBTyxhQUFhLGlCQUFpQixVQUFVLE1BQU0sZUFBZSxXQUFXLFVBQVUsdUJBQXVCLGdCQUFnQixtQkFBbUIsVUFBVSxPQUFPLHNCQUFzQixVQUFVLFVBQVUsV0FBVyxZQUFZLGNBQWMsZUFBZSxTQUFTLGdCQUFnQixzQkFBc0IsZ0JBQWdCLGdCQUFnQixnQkFBZ0Isa0JBQWtCLGdCQUFnQixRQUFRLGVBQWUsZ0JBQWdCLGlCQUFpQixjQUFjLFVBQVUsV0FBVzsiLCJuYW1lcyI6W10sInhfZ29vZ2xlX2lnbm9yZUxpc3QiOlswXX0=