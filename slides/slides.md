---
theme: seriph
title: Cadence
colorSchema: light
layout: center
info: |
  ## Cadence
  Engineering intelligence for your Jira data.
class: text-center
highlighter: shiki
transition: slide-left
mdc: true
fonts:
  sans: Space Grotesk
  serif: Syne
  weights: '400,500,600,700,800'
---

<div class="flex flex-col items-center justify-center h-full">
  <img src="/logo.png" class="h-56 object-contain" />
  <div class="text-2xl tracking-[0.4em] uppercase font-semibold my-7" style="color: var(--qb-orange)">presents</div>
</div>

<!--
Quantum Burrito presents… (Pause — let the brand land, then reveal.)
-->

---
layout: center
class: text-center
---

<div class="flex flex-col items-center justify-center h-full">
  <img src="/cadence.svg" class="h-28 object-contain" />
  <h1 class="text-7xl mt-7"><span class="qb-grad">Cadence</span></h1>
  <div class="text-lg tracking-[0.3em] uppercase opacity-45 mt-3">JIRA Productivity Tools</div>
</div>

<!--
Cadence — JIRA productivity tools. Our internal platform that turns Jira data into answers. (~15 sec)
-->

---
layout: center
class: text-center
---

# We're sitting on <span class="qb-grad">years of Jira data.</span>

<div class="text-2xl opacity-70 mt-6">
  When did it last <span class="italic">answer a really complex question</span> for you?
</div>

<div class="mt-12 text-lg opacity-50">
  Sprint reports, release notes, forecasts, every week, from data you already have.
</div>

<!--
Every team lives in Jira. But Jira is a system of record, not a system of answers. Every sprint, someone hand-writes a summary Jira already contains. Every release, someone combs closed tickets for notes. And when the numbers look off, nobody's sure if it's a real trend or a field someone forgot to fill in.

The data is already there. We just made it answerable. (~1 min)
-->

---
class: is-pitch
---

<div class="pitch">
  <div class="pitch-head">
    <div class="kicker">Meet Cadence</div>
    <h1>Eight tools. <span class="qb-grad">One source of truth.</span></h1>
  </div>
  <div class="pitch-shot"><img src="/screenshots/home.png" /></div>
</div>

<!--
This is Cadence. One home screen, eight focused tools, all reading from a single synced mirror of your Jira data. No JQL, no spelunking through boards. Pick a tool, get an answer. Let me show you the ones you'll open every day. (~45 sec)
-->

---
layout: center
class: text-center
---

<div class="kicker">How it works</div>

# One sync. <span class="qb-grad">Everything local. Every answer instant.</span>

<div class="grid grid-cols-3 gap-10 mt-14 text-left max-w-4xl mx-auto">
  <div>
    <svg viewBox="0 0 256 256" width="52" height="52" class="mb-3" style="color: var(--qb-purple)"><path fill="currentColor" d="M228 48v48a12 12 0 0 1-12 12h-48a12 12 0 0 1 0-24h19l-7.8-7.8a75.55 75.55 0 0 0-53.32-22.26h-.43a75.5 75.5 0 0 0-53.06 21.63a12 12 0 1 1-16.78-17.16a99.38 99.38 0 0 1 69.87-28.47h.52a99.42 99.42 0 0 1 70.2 29.29L204 67V48a12 12 0 0 1 24 0m-44.39 132.43a75.5 75.5 0 0 1-53.09 21.63h-.43a75.55 75.55 0 0 1-53.32-22.26L69 172h19a12 12 0 0 0 0-24H40a12 12 0 0 0-12 12v48a12 12 0 0 0 24 0v-19l7.8 7.8a99.42 99.42 0 0 0 70.2 29.26h.56a99.38 99.38 0 0 0 69.87-28.47a12 12 0 0 0-16.78-17.16Z"/></svg>
    <strong class="text-lg">Mirror once</strong>
    <div class="opacity-60 text-sm mt-1.5">One sync pulls Jira into a clean local mirror. Every tool reads the same snapshot.</div>
  </div>
  <div>
    <svg viewBox="0 0 256 256" width="52" height="52" class="mb-3" style="color: var(--qb-blue)"><path fill="currentColor" d="m213.85 125.46l-112 120a8 8 0 0 1-13.69-7l14.66-73.33l-57.63-21.64a8 8 0 0 1-3-13l112-120a8 8 0 0 1 13.69 7l-14.7 73.41l57.63 21.61a8 8 0 0 1 3 12.95Z"/></svg>
    <strong class="text-lg">Instant &amp; consistent</strong>
    <div class="opacity-60 text-sm mt-1.5">No live Jira calls at click-time. Every tool is fast and always agrees with the others.</div>
  </div>
  <div>
    <svg viewBox="0 0 256 256" width="52" height="52" class="mb-3" style="color: var(--qb-orange)"><path fill="currentColor" d="M208 144a15.78 15.78 0 0 1-10.42 14.94L146 178l-19 51.62a15.92 15.92 0 0 1-29.88 0L78 178l-51.62-19a15.92 15.92 0 0 1 0-29.88L78 110l19-51.62a15.92 15.92 0 0 1 29.88 0L146 110l51.62 19A15.78 15.78 0 0 1 208 144m-56-96h16v16a8 8 0 0 0 16 0V48h16a8 8 0 0 0 0-16h-16V16a8 8 0 0 0-16 0v16h-16a8 8 0 0 0 0 16m88 32h-8v-8a8 8 0 0 0-16 0v8h-8a8 8 0 0 0 0 16h8v8a8 8 0 0 0 16 0v-8h8a8 8 0 0 0 0-16"/></svg>
    <strong class="text-lg">AI on top</strong>
    <div class="opacity-60 text-sm mt-1.5">Claude runs only when you generate — never on every page load.</div>
  </div>
</div>

<!--
Quick on the how, because it's the part that makes the rest believable. Everything reads from one local mirror, so every tool is instant and they never disagree. AI is additive — it runs only when you ask it to generate something. Your data never leaves your network beyond Jira and your AI provider. (~45 sec)
-->

---
layout: center
class: text-center
---

<div class="kicker">Under the hood</div>

# Modern stack. <span class="qb-grad">Boring on purpose.</span>

<div class="grid grid-cols-4 gap-8 mt-14 max-w-5xl mx-auto text-center">
  <div>
    <svg viewBox="0 0 256 256" width="44" height="44" class="mx-auto mb-3" style="color: var(--qb-purple)"><path fill="currentColor" d="M216 36H40a20 20 0 0 0-20 20v144a20 20 0 0 0 20 20h176a20 20 0 0 0 20-20V56a20 20 0 0 0-20-20m-4 24v24H44V60ZM44 196v-88h168v88Z"/></svg>
    <strong>Frontend</strong>
    <div class="opacity-60 text-sm mt-1">React + TypeScript<br/>Vite · Tailwind</div>
  </div>
  <div>
    <svg viewBox="0 0 256 256" width="44" height="44" class="mx-auto mb-3" style="color: var(--qb-blue)"><path fill="currentColor" d="M234.36 170a12 12 0 0 1-4.36 16.37l-96 56a12 12 0 0 1-12.1 0l-96-56a12 12 0 0 1 12.09-20.74l90 52.48L218 165.63a12 12 0 0 1 16.36 4.37M218 117.63l-90 52.48l-89.95-52.48A12 12 0 0 0 26 138.37l96 56a12 12 0 0 0 12.1 0l96-56a12 12 0 0 0-12.1-20.74M20 80a12 12 0 0 1 6-10.37l96-56a12.06 12.06 0 0 1 12.1 0l96 56a12 12 0 0 1 0 20.74l-96 56a12 12 0 0 1-12.1 0l-96-56A12 12 0 0 1 20 80m35.82 0L128 122.11L200.18 80L128 37.89Z"/></svg>
    <strong>Backend</strong>
    <div class="opacity-60 text-sm mt-1">Python · FastAPI<br/>four-stage ETL</div>
  </div>
  <div>
    <svg viewBox="0 0 256 256" width="44" height="44" class="mx-auto mb-3" style="color: var(--qb-orange)"><path fill="currentColor" d="m199 125.31l-49.88-18.39L130.69 57a19.92 19.92 0 0 0-37.38 0l-18.39 49.92L25 125.31a19.92 19.92 0 0 0 0 37.38l49.88 18.39L93.31 231a19.92 19.92 0 0 0 37.38 0l18.39-49.88L199 162.69a19.92 19.92 0 0 0 0-37.38m-63.38 35.16a12 12 0 0 0-7.11 7.11L112 212.28l-16.47-44.7a12 12 0 0 0-7.11-7.11L43.72 144l44.7-16.47a12 12 0 0 0 7.11-7.11L112 75.72l16.47 44.7a12 12 0 0 0 7.11 7.11l44.7 16.47ZM140 40a12 12 0 0 1 12-12h12V16a12 12 0 0 1 24 0v12h12a12 12 0 0 1 0 24h-12v12a12 12 0 0 1-24 0V52h-12a12 12 0 0 1-12-12m112 48a12 12 0 0 1-12 12h-4v4a12 12 0 0 1-24 0v-4h-4a12 12 0 0 1 0-24h4v-4a12 12 0 0 1 24 0v4h4a12 12 0 0 1 12 12"/></svg>
    <strong>AI layer</strong>
    <div class="opacity-60 text-sm mt-1">Claude</div>
  </div>
  <div>
    <svg viewBox="0 0 256 256" width="44" height="44" class="mx-auto mb-3" style="color: var(--qb-pink)"><path fill="currentColor" d="M196 35.52C177.62 25.51 153.48 20 128 20s-49.62 5.51-68 15.52C39.37 46.79 28 62.58 28 80v96c0 17.42 11.37 33.21 32 44.48c18.35 10 42.49 15.52 68 15.52s49.62-5.51 68-15.52c20.66-11.27 32-27.06 32-44.48V80c0-17.42-11.37-33.21-32-44.48m8 92.48c0 17-31.21 36-76 36s-76-19-76-36v-8.46a89 89 0 0 0 8 4.94c18.35 10 42.49 15.52 68 15.52s49.62-5.51 68-15.52a89 89 0 0 0 8-4.94Zm-76-84c44.79 0 76 19 76 36s-31.21 36-76 36s-76-19-76-36s31.21-36 76-36m0 168c-44.79 0-76-19-76-36v-8.46a89 89 0 0 0 8 4.94c18.35 10 42.49 15.52 68 15.52s49.62-5.51 68-15.52a89 89 0 0 0 8-4.94V176c0 17-31.21 36-76 36"/></svg>
    <strong>Data</strong>
    <div class="opacity-60 text-sm mt-1">Jira → local mirror<br/>Bronze · Silver · Gold</div>
  </div>
</div>

<div class="mt-12 text-base opacity-50">No database server, no queue, no vendor SDK — one sync, plain files, served by one process.</div>

<!--
Very high level: a React and TypeScript front end, a Python and FastAPI back end, AI through Claude with an OpenAI fallback, and a four-stage pipeline that turns raw Jira JSON into clean local files. Deliberately simple — no database server, no message queue. One sync, plain files on disk, served by a single process. That's why it's fast and easy to run anywhere. (~45 sec)
-->

---
layout: center
class: text-center
---

<div class="kicker">What's next</div>

# <span class="qb-grad">Beyond Jira.</span>

<div class="grid grid-cols-2 gap-x-14 gap-y-9 mt-12 max-w-4xl mx-auto text-left">
  <div class="flex gap-4">
    <svg viewBox="0 0 256 256" width="38" height="38" class="shrink-0 mt-1" style="color: var(--qb-purple)"><path fill="currentColor" d="M236 64a36 36 0 1 0-48 33.94V112a4 4 0 0 1-4 4H96a28 28 0 0 0-4 .29V97.94a36 36 0 1 0-24 0v60.12a36 36 0 1 0 24 0V144a4 4 0 0 1 4-4h88a28 28 0 0 0 28-28V97.94A36.07 36.07 0 0 0 236 64M80 52a12 12 0 1 1-12 12a12 12 0 0 1 12-12m0 152a12 12 0 1 1 12-12a12 12 0 0 1-12 12M200 76a12 12 0 1 1 12-12a12 12 0 0 1-12 12"/></svg>
    <div><strong class="text-lg">GitHub &amp; GitLab</strong><div class="opacity-60 text-sm mt-1">Sync PRs, commits and CI alongside Jira — correlate delivery with the code that shipped it.</div></div>
  </div>
  <div class="flex gap-4">
    <svg viewBox="0 0 256 256" width="38" height="38" class="shrink-0 mt-1" style="color: var(--qb-blue)"><path fill="currentColor" d="m137 168l11.52-11.51a12 12 0 0 0-17-17L120 151l-15-15l11.52-11.51a12 12 0 0 0-17-17L88 119l-15.51-15.49a12 12 0 0 0-17 17L59 124l-20.46 20.49a36 36 0 0 0 0 50.91l2.55 2.54l-25.58 25.57a12 12 0 0 0 17 17l25.57-25.58l2.54 2.55a36.06 36.06 0 0 0 50.91 0L132 197l3.51 3.52a12 12 0 0 0 17-17Zm-42.46 32.49a12 12 0 0 1-17 0l-22.03-22.06a12 12 0 0 1 0-17L76 141l39 39Zm146-185a12 12 0 0 0-17 0l-25.6 25.6l-2.54-2.55a36.05 36.05 0 0 0-50.91 0L124 59l-3.51-3.52a12 12 0 0 0-17 17l80 80a12 12 0 0 0 17-17L197 132l20.49-20.49a36 36 0 0 0 0-50.91l-2.55-2.54l25.58-25.57a12 12 0 0 0-.03-16.98Zm-40 79L180 115l-39-39l20.49-20.49a12 12 0 0 1 17 0l22.06 22.06a12 12 0 0 1 0 17Z"/></svg>
    <div><strong class="text-lg">More sources</strong><div class="opacity-60 text-sm mt-1">Slack, incidents, calendars — one mirror, every delivery signal in a single place.</div></div>
  </div>
  <div class="flex gap-4">
    <svg viewBox="0 0 256 256" width="38" height="38" class="shrink-0 mt-1" style="color: var(--qb-orange)"><path fill="currentColor" d="M72 104a16 16 0 1 1 16 16a16 16 0 0 1-16-16m96 16a16 16 0 1 0-16-16a16 16 0 0 0 16 16m68-40v112a36 36 0 0 1-36 36H56a36 36 0 0 1-36-36V80a36 36 0 0 1 36-36h60V16a12 12 0 0 1 24 0v28h60a36 36 0 0 1 36 36m-24 0a12 12 0 0 0-12-12H56a12 12 0 0 0-12 12v112a12 12 0 0 0 12 12h144a12 12 0 0 0 12-12Zm-12 82a30 30 0 0 1-30 30H86a30 30 0 0 1 0-60h84a30 30 0 0 1 30 30m-80-6v12h16v-12Zm-34 12h10v-12H86a6 6 0 0 0 0 12m90-6a6 6 0 0 0-6-6h-10v12h10a6 6 0 0 0 6-6"/></svg>
    <div><strong class="text-lg">Deeper agents</strong><div class="opacity-60 text-sm mt-1">An Ask that acts across sources — not just answering, but drafting and updating work.</div></div>
  </div>
  <div class="flex gap-4">
    <svg viewBox="0 0 256 256" width="38" height="38" class="shrink-0 mt-1" style="color: var(--qb-pink)"><path fill="currentColor" d="M222.41 155.16a12 12 0 0 0-11.56-.69A16 16 0 0 1 188 139a16.2 16.2 0 0 1 14.8-15a15.83 15.83 0 0 1 8 1.5a12 12 0 0 0 17.2-10.8V72a20 20 0 0 0-20-20h-32a40.15 40.15 0 0 0-12.62-29.16a39.67 39.67 0 0 0-29.94-10.76a40.08 40.08 0 0 0-37.34 37C96 50.07 96 51 96 52H64a20 20 0 0 0-20 20v28a40.15 40.15 0 0 0-29.16 12.62A40 40 0 0 0 41.1 179.9a28 28 0 0 0 2.9.1v28a20 20 0 0 0 20 20h144a20 20 0 0 0 20-20v-42.69a12 12 0 0 0-5.59-10.15M204 204H68v-38.69a12 12 0 0 0-17.15-10.84A15.9 15.9 0 0 1 42.8 156A16.2 16.2 0 0 1 28 141.06a16 16 0 0 1 22.82-15.52A12 12 0 0 0 68 114.7V76h42.7a12 12 0 0 0 10.83-17.15A15.9 15.9 0 0 1 120 50.8A16.19 16.19 0 0 1 134.94 36a16 16 0 0 1 15.53 22.81A12 12 0 0 0 161.31 76H204v24c-1 0-1.93 0-2.9.11A40 40 0 0 0 204 180Z"/></svg>
    <div><strong class="text-lg">Yours to extend</strong><div class="opacity-60 text-sm mt-1">Drop a new metric file in the pipeline — it's auto-discovered and runs in parallel.</div></div>
  </div>
</div>

<!--
Where this goes next. The big one is connecting GitHub and GitLab — once we mirror pull requests, commits and CI next to Jira, we can correlate what was planned with the code that actually shipped. Beyond that: more sources like Slack and incidents, a more agentic Ask that can act and not just answer, and the fact that any new metric is just a file you drop into the pipeline. The architecture was built to grow. (~45 sec)
-->

---
layout: center
class: text-center
---

<div class="flex flex-col items-center justify-center h-full">
  <img src="/cadence.svg" class="h-14 object-contain mb-10 opacity-90" />
  <h1 class="text-8xl"><span class="qb-grad">Thank you.</span></h1>
  <a class="mt-8 text-xl opacity-55" href="https://cadence.kpazdera.workers.dev/">https://cadence.kpazdera.workers.dev/</a>
  <a class="mt-2 text-xl opacity-55" href="https://github.com/etylsarin/cadence">https://github.com/etylsarin/cadence</a>
</div>

<!--
Thank you. Happy to demo any tool live right now.
-->
