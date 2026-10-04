# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <strong>العربية</strong>
</p>

هذه **نسخة مخصّصة من [Codeg](https://github.com/xintaofei/codeg) يصونها keh4l**. ‏Codeg مساحة عمل برمجية متعددة الوكلاء من تطوير xintaofei: كل وكلاء البرمجة بالذكاء الاصطناعي في مكان واحد، يعملون معًا. تتابع هذه النسخة المشروع الأصلي عن قرب وتضيف بعض الأشياء الخاصة بها؛ وكل ما لم يُذكر أدناه يعمل تمامًا كما في التطبيق الرسمي.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## الاختلافات عن النسخة الرسمية

- **‏Kiro CLI وكيل مدمج.** يشغّل Codeg أداة `kiro-cli` التي ثبّتها باستخدام [مثبّت Kiro الرسمي](https://kiro.dev/docs/getting-started/installation/). يمكنك اختيار النموذج والوضع ومستوى الاستدلال والتفكير من مربع الإدخال، واستخدام أوامر الشرطة المائلة، واختيار وضع الأذونات (السؤال في كل مرة أو الوثوق بجميع الأدوات)، وتزويده بخوادم MCP والمهارات، واستيراد جلساته السابقة ومتابعتها. يشغّل زر «ترقية» في الإعدادات ← الوكلاء أداة التحديث الخاصة بـ Kiro. تنتقل المحادثات التي أجريتها مع Kiro كوكيل مخصّص إلى الوكيل المدمج. وقد اقتُرحت هذه الميزة على المشروع الأصلي أيضًا: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **يمكن لكل نافذة متصفح أن تحتفظ بعلامات تبويبها الخاصة.** لم تعد النوافذ المتعددة على الخادم نفسه تتبع بعضها: فتح علامة تبويب محادثة أو التركيز عليها أو إغلاقها في نافذة يترك النوافذ الأخرى كما هي، وعند إعادة التحميل تعود علامات تبويب تلك النافذة نفسها. أما المحادثات والرسائل وعمليات الحذف فتصل إلى كل النوافذ كما في السابق. يتحكم في ذلك مفتاح «مزامنة علامات تبويب المحادثات بين النوافذ» في الإعدادات ← عام: معطّل افتراضيًا في المتصفح ومفعّل في تطبيق سطح المكتب، وعند تفعيله تتشارك كل النوافذ مجموعة واحدة من علامات التبويب كما في الإصدار الرسمي. طُلبت هذه الميزة من المشروع الأصلي في [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **يعرض Claude Code تفكيره.** مع النماذج الحديثة لا تتلقى النسخة الرسمية إلا توقيعًا مشفّرًا لكل كتلة تفكير، فيبقى تفكير Claude فارغًا. تطلب هذه النسخة من الواجهة البرمجية (API) ملخّصات للتفكير، وهي نفسها التي يعرضها `claude` في الطرفية عند تفعيل `showThinkingSummaries`. لإيقافها، أضف `"showThinkingSummaries": false` إلى `~/.claude/settings.json` (أو إلى ملف `.claude/settings.json` الخاص بالمشروع). لم يُرسَل نص التفكير للمحادثات السابقة أصلًا، لذا لا يمكن استعادته.
- **تأتي التحديثات من هذا المستودع.** تُوقَّع الإصدارات بمفتاح التحديث الخاص بهذا الفرع، فلا تتحدّث هذه النسخة أبدًا إلى إصدار رسمي، ولا تتحدّث نسخة رسمية إلى أحد هذه الإصدارات.
- **تطبيق macOS غير موثّق (notarized) من Apple**، لذا يطلب macOS التأكيد مرة واحدة عند فتحه أول مرة (انظر «التثبيت» أدناه).
- **لا توجد صورة Docker.**

## الإصدارات والمشروع الأصلي

فرع `keh4l` هو فرع `main` في المشروع الأصلي مضافًا إليه التغييرات أعلاه. تُدمج تحديثات المشروع الأصلي بانتظام، فتصل ميزاته الجديدة إلى هذه النسخة أيضًا. يُكتب رقم الإصدار بالشكل `<إصدار المشروع الأصلي>-<رقم>`: ‏`0.32.4-1` هو أول إصدار مبني على الإصدار الأصلي 0.32.4.

## التثبيت

**سطح المكتب** — نزّل أحدث مُثبّت من [Releases](https://github.com/keh4l/codeg/releases/latest): ملف `.dmg` لنظام macOS (Apple Silicon أو Intel)، و`-setup.exe` لنظام Windows (x64 أو ARM64)، و`.deb` أو `.rpm` أو `.AppImage` لنظام Linux.

يُثبَّت بوصفه التطبيق نفسه الذي هو Codeg الرسمي: يحلّ محلّه ويحتفظ بمحادثاتك وإعداداتك.

على macOS، إذا ظهرت عند التشغيل الأول رسالة بأن التطبيق تالف أو لا يمكن فتحه، فنفّذ هذا الأمر مرة واحدة:

```bash
xattr -cr /Applications/codeg.app
```

أو اسمح بفتحه من إعدادات النظام ← الخصوصية والأمان.

**الخادم** — على Linux أو macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

على Windows، في PowerShell:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

كلاهما يثبّت من إصدارات هذا المستودع، وأداة التحديث المدمجة في الخادم تستخدمها أيضًا.

**العودة إلى النسخة الرسمية** — انسخ بيانات Codeg احتياطيًا أولًا. تضيف هذه النسخة ترحيلًا لقاعدة البيانات خاصًا بـ Kiro، وقد ترفض النسخة الرسمية التي لا تتضمّنه البدء بالبيانات نفسها.

## التوثيق

للتعرّف على الميزات والإعدادات وطريقة الاستخدام، راجع [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.ar.md) الرسمي و[docs.codeg.app](https://docs.codeg.app). يصفان النسخة الرسمية؛ والاختلافات مذكورة أعلاه.

## الترخيص والشكر

Apache-2.0، راجع [LICENSE](../../LICENSE). ‏Codeg من تطوير [xintaofei](https://github.com/xintaofei) والمساهمين، وهذه النسخة تضيف إليه فقط. يعتمد Codeg على [Agent Client Protocol](https://agentclientprotocol.com) و[Superpowers](https://github.com/obra/superpowers) و[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) و[scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
