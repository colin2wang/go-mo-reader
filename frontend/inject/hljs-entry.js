/*
 * hljs-entry.js — highlight.js 打包入口（仅构建用，不参与运行时页面）
 *
 * 产物：`assetsrv/vendor/highlight.js`（IIFE，挂载到 window.hljs），
 * 由 `pnpm run build:inject` 生成，Go 端 //go:embed 后以 /mr-vendor/highlight.js 注入章节。
 *
 * 这里只注册常用语言子集：全量 190+ 语言会把产物撑到 1MB 级别，
 * 而技术类电子书实际用到的语言集中在下面这份白名单里。
 * 需要新增语言时在此处追加 import + registerLanguage 即可。
 */
import hljs from 'highlight.js/lib/core'

import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import nginx from 'highlight.js/lib/languages/nginx'
import objectivec from 'highlight.js/lib/languages/objectivec'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import properties from 'highlight.js/lib/languages/properties'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGS = {
  bash, c, cpp, csharp, css, dart, diff, dockerfile, go, ini, java, javascript,
  json, kotlin, lua, makefile, markdown, nginx, objectivec, perl, php, plaintext,
  properties, python, ruby, rust, scala, scss, sql, swift, typescript, xml, yaml
}

Object.keys(LANGS).forEach((name) => {
  hljs.registerLanguage(name, LANGS[name])
})

// 补几个书籍里常见的写法；已存在的别名（bash 自带 sh、xml 自带 html）跳过，避免重复注册报错
function addAlias(alias, name) {
  try {
    if (hljs.getLanguage(alias) === undefined) hljs.registerAliases([alias], {languageName: name})
  } catch (err) { /* 忽略 */ }
}
;['shell', 'sh', 'zsh', 'console', 'terminal'].forEach((a) => addAlias(a, 'bash'))
;['html', 'xhtml', 'svg', 'vue'].forEach((a) => addAlias(a, 'xml'))

// 输出纯 HTML 字符串；章节里的内容来自 textContent，不存在 XSS 注入面
hljs.configure({ignoreUnescapedHTML: true, throwUnescapedHTML: false})

export default hljs
