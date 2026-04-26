# Labirinto — Documentação de Engenharia de Software

> Versão do documento: 1.3 | Criado: 21/04/2026 | Revisado: 25/04/2026 (Help/Privacidade + Back Android + Heart fix)
> Compatível com Android Studio Meerkat (AGP 9.2.0 / compileSdk 37)

---

## 1. Visão Geral da Arquitetura

O aplicativo é um **jogo Sokoban** (empurrar caixas em labirinto) implementado como **Single-Page Application React/Vite** servida dentro de um **WebView Android nativo**. A escolha de arquitetura é intencionalmente "shell nativo + web app", o que concentra toda a lógica de jogo no JavaScript e usa o Android apenas como contêiner UI.

```
┌─────────────────────────────────────────────────┐
│                  ANDROID SHELL                  │
│  ┌───────────────────────────────────────────┐  │
│  │           MainActivity.java               │  │
│  │  - EdgeToEdge.enable()                    │  │
│  │  - WebViewAssetLoader (https seguro)      │  │
│  │  - Injeção de insets via evaluateJavascript│  │
│  │  - Salvar/restaurar estado WebView        │  │
│  └────────────────┬──────────────────────────┘  │
│                   │  WebView                     │
│  ┌────────────────▼──────────────────────────┐  │
│  │         WEB FRONTEND (React 19)           │  │
│  │  App.jsx — componente raiz único (SPA)    │  │
│  │  App.css  — design tokens + layout        │  │
│  │  index.css — reset global                 │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 1.1 Fluxo de build

```
Labirinto/ (Vite + React)
    npm run build
         │
         ▼
app/src/main/assets/www/   ← saída do Vite
         │
         ▼
Android Gradle build
    → APK / AAB (debug | release)
```

O script `scripts/copy-dist-to-android.cjs` replica manualmente o artefato caso o `outDir` do Vite seja alterado.

---

## 2. Estrutura de Pacotes

### 2.1 Android (Java)

```
app/src/main/
├── AndroidManifest.xml
├── java/com/labirinto/webview/
│   └── MainActivity.java          ← única Activity
└── res/
    ├── layout/activity_main.xml   ← FrameLayout > WebView
    └── values/themes.xml          ← Theme.Labirinto
```

### 2.2 Web Frontend (React/Vite)

```
Labirinto/src/
├── main.jsx          ← bootstrap React (monta <App /> em #root)
├── index.css         ← reset: html/body/#root → height:100%, overflow:hidden
├── App.jsx           ← componente único (~1450 linhas); toda a lógica de jogo
├── App.css           ← tokens CSS, layout responsivo, animações
└── assets/           ← imagens (Splash.png, Rock, Person) + faixas MP3
```

---

## 3. Componentes e Responsabilidades

### 3.1 `MainActivity.java`

| Responsabilidade | Implementação |
|---|---|
| Modo Edge-to-Edge | `EdgeToEdge.enable(this)` |
| Carregamento de assets | `WebViewAssetLoader` em `https://appassets.androidplatform.net/assets/` |
| Comunicação de insets | `evaluateJavascript` injeta `window.__ANDROID_INSETS__` + dispara `androidInsetsChanged` |
| Navegação Back | `OnBackPressedCallback` — em `#/ajuda` e `#/privacidade` volta no histórico; no tabuleiro fecha o app |
| Persistência WebView | `onSaveInstanceState` / `restoreState` via Bundle `WEBVIEW_STATE` |
| Ciclo de vida áudio | `webView.onResume()` / `webView.onPause()` |
| Media Playback | `setMediaPlaybackRequiresUserGesture(false)` (Autoplay permitido) |
| Play Games Auth | Inicializa SDK, tenta sign-in automático e notifica JS via evento `playGamesAuth` |

**Configurações de segurança WebView aplicadas:**
- `setAllowFileAccess(false)`
- `setAllowContentAccess(false)`
- JavaScript habilitado apenas via `AssetLoader` (origin `https://`)
- Autoplay habilitado para transições suaves de áudio background

### 3.2 `activity_main.xml`

```xml
FrameLayout (match_parent × match_parent)
└── WebView (id=webView, match_parent × match_parent)
```

Design intencional: sem `CoordinatorLayout`, sem `AppBar`. O WebView ocupa 100% da tela, incluindo debaixo das barras do sistema.

### 3.3 `themes.xml` — `Theme.Labirinto`

| Atributo | Valor | Efeito |
|---|---|---|
| `statusBarColor` | `@android:color/transparent` | Barra de status transparente |
| `navigationBarColor` | `@android:color/transparent` | Barra de navegação transparente |
| `windowDrawsSystemBarBackgrounds` | `true` | Activity desenha atrás das barras |
| `windowLayoutInDisplayCutoutMode` | `shortEdges` | Conteúdo não entra na área de entalhe lateral, mas entra nos entalhe top/bottom |
| `windowLightStatusBar` | `true` | Ícones escuros na barra de status |
| `windowLightNavigationBar` | `true` | Ícones escuros na barra de navegação |
| `enforceNavigationBarContrast` | `false` | Sistema não força contraste automático |
| `enforceStatusBarContrast` | `false` | Sistema não força contraste automático |

### 3.4 `App.jsx` — Máquina de Estados do Jogo

O componente `App` é uma **máquina de estados plana** implementada com `useState`/`useRef`/`useEffect`. Os estados principais são:

```
Estados de Fluxo de Tela:
  splashVisible     → true durante 5 s (SPLASH_DURATION_MS)
  levelsReady       → false até buildCampaignFast() completar
  view              → 'game' | 'help' | 'privacy'  (sincronizado com window.location.hash)

Estados de Fase:
  phaseComplete     → fase concluída, aguardando avançar
  gameWon           → última fase concluída
  gameOver          → pontuação zerada por tempo

Estados de Pontuação/Tempo:
  isOvertime        → tempo principal esgotado, prorrogação ativa
  overtimeWarningOpen → modal de aviso de prorrogação visível
  score             → pontuação acumulada total
  phaseElapsedSeconds → segundos decorridos na fase atual
```

**Geração procedural de fases:**

```
buildCampaignFast(count, startIdx, sessionStart)
  └─ generateCandidateLevel(seed)
       ├─ createRng(seed)           — PRNG determinístico (Mulberry32)
    ├─ addSafeCentralBlockers()  — adiciona 4-7 paredes internas
       ├─ valida conectividade (BFS: isMapConnected)
    ├─ posiciona goals (2 fixos por fase procedural)
    └─ posiciona boxes (2 fixas por fase procedural)
  └─ isLevelSolvable(level) [NOVO]
    └─ BFS Solver: Simula movimentos até a vitória ou limite de 2000 estados.
          Garante 100% de jogabilidade antes de apresentar a fase ao usuário.
  └─ MANUAL_LEVEL_OVERRIDES.HEART
    └─ fase especial após 30 min de sessão, injetada a cada múltiplo de 50 fases.

**Sistema de Fases Infinitas:**
O app inicia com buffer pequeno (`LEVEL_COUNT_INITIAL = 10`) para reduzir custo inicial e adiciona mais 10 fases sob demanda ao aproximar do fim da lista (`next >= levels.length - 3`), mantendo progressão contínua com geração incremental.

**Regra de conclusão de fase:**
A vitória da fase é validada por alvos preenchidos (`goals.length`) e não pela quantidade total de caixas. Isso garante conclusão correta em fases especiais com mais caixas que alvos (ex.: HEART).
```

Representação do mapa: matriz `number[][]` com valores:
- `0` = chão livre
- `1` = parede
- `2` = objetivo (goal)
- `3` = caixa (box, armazenado temporariamente; extraído em `parseLevel`)

**Sistema de pontuação:**

```
Tempo normal (0 → 60 s):
  pontuação = PHASE_MAX_SCORE × (1 - elapsed/target)
  PHASE_MAX_SCORE = 2000

Prorrogação (após 60 s):
  overtimeMs = max(20 s, target × 0.4) = 24 s
  pontuação = phaseEntryScore × (1 - overtime_elapsed/overtimeMs)
  → decai linearmente até 0; ao zerar → GAME OVER
```

### 3.5 Sistema de Insets / Layout Responsivo

O bridge nativo→web funciona em duas etapas:

```
Android (Java)                         Web (JS/CSS)
─────────────                          ────────────
ViewCompat.setOnApplyWindowInsetsListener
  → evaluateJavascript(
      "window.__ANDROID_INSETS__={top,right,bottom,left};
       window.dispatchEvent(new Event('androidInsetsChanged'))"
    )
                    ──────────────────►
                                       useEffect ouve 'androidInsetsChanged'
                                         → setAndroidInsets(insets)
                                         → root.style.setProperty(
                                             '--android-inset-top', Xpx)
                                         → (idem right/bottom/left)

CSS combina:
  --safe-area-top = max(env(safe-area-inset-top), --android-inset-top)
  padding-top = calc(--shell-padding-y + --safe-area-top)
```

O layout é calculado em JS puro a partir das variáveis de viewport/insets e injetado como CSS custom properties (`shellStyle`), controlando tamanho de célula, painel lateral, botões, etc.

---

## 4. Dependências Críticas

### 4.1 Android

| Biblioteca | Versão | Uso |
|---|---|---|
| `androidx.core` | 1.18.0 | `ViewCompat`, `WindowInsetsCompat` |
| `androidx.appcompat` | 1.7.1 | `AppCompatActivity`, `Theme.AppCompat` |
| `androidx.webkit` | 1.15.0 | `WebViewAssetLoader` |
| `androidx.activity` | 1.13.0 | `EdgeToEdge`, `OnBackPressedCallback` |

### 4.2 Web

| Pacote | Uso |
|---|---|
| React 19 | UI declarativa + hooks |
| Vite | Bundler, dev server, build para `/assets/www` |
| `@vitejs/plugin-react` + `reactCompilerPreset` | React Compiler (otimização automática de memoização) |
| `@rolldown/plugin-babel` | Transpilação para React Compiler |

---

## 5. Comportamentos de UI Identificados e Análise de Causas

Esta seção cataloga **todos os pontos de risco para comportamento indesejado de UI** encontrados na análise do código:

---

### 🔴 CRÍTICO — UI-01: Race condition entre insets e carregamento da página

**Arquivo:** `MainActivity.java`, linhas 43-56  
**Arquivo:** `App.jsx`, useEffect de `androidInsetsChanged`

**Descrição:**  
`ViewCompat.requestApplyInsets(binding.webView)` é chamado logo após `setContentView`, antes de a página web terminar de carregar. O `evaluateJavascript` é executado nesse momento, mas o listener `androidInsetsChanged` na aplicação React pode ainda não estar registrado (a página está em `loadUrl`). Os insets chegam no JS antes do `useEffect` do React ser montado.

**Sintoma esperado:**  
Padding do topo/bottom incorreto no primeiro carregamento. O conteúdo pode aparecer parcialmente atrás da status bar ou navigation bar. Ao girar o dispositivo ou minimizar/retomar o app, os insets são reaplicados corretamente (pois o listener já existe).

**Fluxo problemático:**
```
onCreate()
  EdgeToEdge.enable()          ← barras ficam transparentes
  setContentView()
  requestApplyInsets()         ← dispara ANTES da página carregar
    → evaluateJavascript(...)  ← JS não está pronto ainda → insets ignorados
  webView.loadUrl(...)         ← página começa a carregar
  ... (assíncrono) ...
  onPageFinished()             ← React monta, useEffect registra listener
                               ← MAS o evento 'androidInsetsChanged' já passou
```

**Solução recomendada:**  
Em `onPageFinished`, re-disparar os insets via `ViewCompat.requestApplyInsets(view)` para garantir que o JS já esteja pronto.

```java
@Override
public void onPageFinished(WebView view, String url) {
    super.onPageFinished(view, url);
    backCallback.setEnabled(view.canGoBack());
    // Re-aplica insets após a página estar pronta
    ViewCompat.requestApplyInsets(binding.webView);
}
```

---

### 🔴 CRÍTICO — UI-02: `windowLayoutInDisplayCutoutMode = shortEdges` pode clipar conteúdo lateral

**Arquivo:** `res/values/themes.xml`

**Descrição:**  
O valor `shortEdges` permite que o conteúdo se estenda para a área de entalhe (notch/punch-hole) apenas nas **bordas curtas** (topo e base em portrait; laterais em landscape). Porém, o CSS do jogo usa `padding-top: calc(... + --safe-area-top)` para compensar, e em landscape, a tela pode ter o entalhe em uma lateral sem compensação CSS correspondente.

**Sintoma esperado:**  
Em landscape com câmera punch-hole lateral: conteúdo do labirinto fica parcialmente atrás da câmera sem padding compensatório.

**Solução recomendada:**  
Alterar para `shortEdges` → `always` para permitir que o CSS controle completamente a compensação:
```xml
<item name="android:windowLayoutInDisplayCutoutMode">always</item>
```

---

### 🟡 MÉDIO — UI-03: `100dvh` com suporte incompleto em WebView antigas

**Arquivo:** `App.css` (`.app-shell`, `#root`)  
**Arquivo:** `index.css` (`#root`)

**Descrição:**  
A unidade `dvh` (dynamic viewport height) só está disponível no Chromium 108+. O `minSdk = 24` (Android 7.0) usa WebView baseado em Chrome 53 em dispositivos não atualizados. Em versões antigas, `100dvh` recai para `100vh`, que não desconta o teclado virtual, causando overflow quando o teclado está aberto.

**Sintoma esperado:**  
Em dispositivos Android antigos (sem atualização do WebView), o jogo pode transbordar verticalmente ou mostrar a barra de scroll.

**Mitigação atual:**  
O CSS já tem `overflow: hidden` no `body` e `#root`, o que mascara o overflow. O risco real é o conteúdo ser cortado quando o teclado virtual abre (improvável neste jogo, pois não há campos de texto).

---

### 🟡 MÉDIO — UI-04: Reinicialização dupla do `phaseStartTimeRef`

**Arquivo:** `App.jsx`, dois `useEffect` conflitantes

**Descrição:**  
Existe um `useEffect([], [])` (deps vazias, linha ~1196) que executa `phaseStartTimeRef.current = Date.now()` incondicionalmente na montagem. Porém, o `useEffect` de `[levelsReady, levels]` também define `phaseStartTimeRef.current = Date.now()` ao iniciar o primeiro nível. Se o `useEffect` de deps vazias rodar **depois** do `levelsReady` (o que ocorre quando os níveis são gerados sincronicamente via `buildCampaignFast`), o timer da fase 1 é reiniciado incorretamente, dando um pequeno "crédito extra" de tempo.

**Sintoma esperado:**  
O cronômetro da primeira fase começa levemente atrasado em relação ao momento real de apresentação do labirinto.

---

### 🟡 MÉDIO — UI-05: Viewport metrics calculadas antes do layout estabilizar

**Arquivo:** `App.jsx`, `useEffect` de `syncViewport` / `debouncedSyncViewport`

**Descrição:**  
`getViewportMetrics()` usa `window.visualViewport?.width` com debounce de 150 ms. Na montagem, o viewport inicial é capturado no `syncViewport()` chamado dentro do `useEffect`. Porém, no Android WebView, o `visualViewport` pode reportar dimensões incorretas nos primeiros frames enquanto o sistema ajusta insets, zoom e orientação.

**Sintoma esperado:**  
No primeiro render, o `cellSize` do labirinto pode ser calculado com viewport incorreto, causando células muito pequenas ou muito grandes por um frame (flicker de layout).

**Solução recomendada:**  
Adicionar um segundo `syncViewport()` após 300 ms da montagem para garantir captura após o sistema estabilizar:
```js
setTimeout(syncViewport, 300)
```

---

### 🟡 MÉDIO — UI-06: `windowLightStatusBar/NavigationBar = true` com fundo escuro

**Arquivo:** `res/values/themes.xml`

**Descrição:**  
`windowLightStatusBar = true` força ícones **escuros** na status bar, adequado quando o fundo atrás da barra é claro. O gradiente de fundo do jogo começa com `--bg-forest: #d7e8be` (verde claro), então funciona na maioria dos casos. Porém, durante a tela de splash ou em dispositivos com baixo brilho, o contraste pode ser insuficiente.

**Sintoma esperado:**  
Ícones da status bar (hora, bateria, sinal) difíceis de ler em algumas condições de iluminação.

---

### 🟢 BAIXO — UI-07: Música bloqueada por autoplay policy no WebView

**Arquivo:** `App.jsx`, `useEffect` de autoplay de música

**Descrição:**  
`playNextRef.current?.()` é chamado na montagem para iniciar a trilha sonora. O Android WebView bloqueia áudio sem interação prévia do usuário (política de autoplay). O código tem um fallback:
```js
document.addEventListener('pointerdown', onFirstInteract, { once: true })
```
Isso é correto, mas o `Audio()` criado antes da interação pode falhar silenciosamente e o fallback só tenta reproduzir se `bgAudioRef.current?.paused`. Se o `Audio()` foi criado mas não reproduziu, `paused` pode ser `true`, então o fallback funciona. Risco baixo, mas a sequência é frágil.

---

### 🟢 BAIXO — UI-08: Save/Restore de WebView não preserva estado de UI calculado

**Arquivo:** `MainActivity.java`, `onSaveInstanceState` / `restoreState`

**Descrição:**  
`binding.webView.saveState(bundle)` preserva o histórico de navegação e scroll position do WebView, mas **não** preserva o estado JavaScript. Após restauração de processo (quando o Android mata o app em background e o usuário retorna), o JS reinicia do zero e lê o estado do `localStorage`. Os insets são então reaplicados corretamente via `androidInsetsChanged`. Este fluxo está correto, mas significa que há uma tela preta/branca enquanto o React remonta e lê o save.

---

## 6. Diagrama de Fluxo de Telas

```
App inicia
    │
    ├─ splashVisible = true ──────────────────────────────┐
    │   (5 segundos)                                       │
    │                                              Splash Screen
    │   [levelsReady e splashVisible ambos aguardados]    │
    │                                                     │
    ▼ (splashVisible = false)                             ◄┘
    │
    ├─ !levelsReady ──────────► Loading Screen
    │                               (raramente visível — geração é rápida)
    │
    ├─ view === 'help' ──────► Help Screen
    │                               (hash #/ajuda)
    │
    ├─ view === 'privacy' ───► Privacy Screen
    │                               (hash #/privacidade)
    │
    └─ view === 'game' ──────► Game Screen
            │
            ├─ overtimeWarningOpen ──► Modal "PRORROGAÇÃO ATIVA"
            ├─ phaseComplete ────────► Modal "ROTAS DESOBSTRUÍDAS"
            ├─ gameWon ──────────────► Modal "CIDADE INVADIDA"
            └─ gameOver ─────────────► Modal "TEMPO ESGOTADO"
```

---

## 7. Contrato de Comunicação Android → Web (Bridge de Insets)

### Direção: Android → Web

```
Evento Android: WindowInsetsCompat disponível

Java injeta:
  window.__ANDROID_INSETS__ = { top: N, right: N, bottom: N, left: N }
  window.dispatchEvent(new Event('androidInsetsChanged'))

React ouve:
  window.addEventListener('androidInsetsChanged', applyAndroidInsets)
  → document.documentElement.style.setProperty('--android-inset-top', Npx)
  → (idem outros lados)
```

### Direção: Web → Android

Não existe bridge Web→Android neste projeto. Não há `addJavascriptInterface`. Toda comunicação é unidirecional (Android informa a web sobre insets).

---

## 8. Configuração de Build

### Debug
```bash
# Na raiz do workspace (V1)
npm run build:android  # build web + cópia para app/src/main/assets/www

# No Android Studio ou terminal:
./gradlew assembleDebug
```

### Release
```bash
npm run build:android
./gradlew assembleRelease   # requer keystore configurado
```

**Variáveis de build relevantes (`app/build.gradle`):**

| Propriedade | Valor |
|---|---|
| `compileSdk` | 37 |
| `targetSdk` | 37 |
| `minSdk` | 24 (Android 7.0) |
| `minifyEnabled` | true (release) |
| `shrinkResources` | true (release) |
| `resConfigs` | "en", "pt" |

### 8.1 Segurança de Assinatura (Release Signing)

As credenciais de produção (Keystore e senhas) **não estão expostas no repositório**. 
O `app/build.gradle` está configurado para ler variáveis de ambiente do arquivo `local.properties`, que é ignorado pelo Git.

**Variáveis esperadas no `local.properties`:**
- `RELEASE_STORE_FILE`
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`

---

## 9. Checklist de Intervenções Recomendadas por Prioridade

> Última atualização: 25/04/2026 — itens ✅ refletem o estado atual do app nesta data.

| # | Issue | Arquivo | Ação | Prioridade | Status |
|---|---|---|---|---|---|
| 1 | UI-01 | `MainActivity.java` | `requestApplyInsets` adicionado em `onPageFinished` | 🔴 Alta | ✅ Aplicado |
| 2 | UI-02 | `themes.xml` | `shortEdges` → `always` | 🔴 Alta | ✅ Aplicado |
| 3 | UI-04 | `App.jsx` | `useEffect` duplicado de `phaseStartTimeRef` removido | 🟡 Média | ✅ Aplicado |
| 4 | UI-05 | `App.jsx` | `setTimeout(syncViewport, 300)` adicionado na montagem | 🟡 Média | ✅ Aplicado |
| 5 | UI-06 | `themes.xml` | Avaliar `windowLightStatusBar` → `false` se o fundo ficar escuro | 🟡 Média | ⏳ Pendente (avaliar em dispositivo) |
| 6 | UI-03 | `App.css` / `index.css` | Fallback `height: 100vh` adicionado antes de `100dvh` | 🟢 Baixa | ✅ Aplicado |
| 7 | UI-07 | `App.jsx` / `MainActivity.java` | `setMediaPlaybackRequiresUserGesture(false)` adicionado para permitir música background | 🟢 Baixa | ✅ Aplicado |
| 8 | NAV-01 | `MainActivity.java` | Back Android: ajuda/privacidade volta no histórico; tabuleiro fecha o app | 🔴 Alta | ✅ Aplicado |
| 9 | UX-01 | `App.jsx` / `App.css` | Tela de ajuda reformulada e botão para privacidade | 🟡 Média | ✅ Aplicado |
| 10 | PRIV-01 | `App.jsx` / `App.css` | Página de política offline integrada ao app com botão "Voltar ao Jogo" | 🟡 Média | ✅ Aplicado |
| 11 | GAME-01 | `App.jsx` | Correção da vitória por `goals.length` para evitar bloqueio na fase HEART | 🔴 Alta | ✅ Aplicado |

---

## 11. Design de Níveis e Estratégias (Campanha Infinita)

O jogo evoluiu de 200 fases fixas para uma progressão infinita validada por IA.

### 11.1 Algoritmo de Geração com Solver Integrado

As fases são geradas via `buildCampaignFast`. O diferencial agora é a integração do `isLevelSolvable`:
1. **Geração Candidata:** O gerador cria um layout.
2. **Simulação de IA:** Um robô (BFS Solver) tenta resolver a fase em background.
3. **Filtro de Qualidade:** Se a IA não resolver em 2000 passos, a fase é descartada e uma nova seed é tentada.
4. **Garantia:** Isso elimina fases impossíveis (como a antiga Fase 9) sem necessidade de intervenção manual constante.

### 11.2 Easter Egg: Fase de Coração

Implementamos um "Manual Override" especial:
- **ID:** `HEART`.
- **Condição:** 30 minutos de gameplay na sessão (`sessionStartTime`) e inserção em múltiplos de 50 fases.
- **Layout:** Um labirinto em formato de coração com 4 objetivos e 6 caixas.
- **Objetivo:** Recompensar a retenção do usuário com um conteúdo visual único.

**Importante:** a conclusão da fase HEART ocorre ao preencher todos os alvos (4), independentemente de caixas excedentes.

### 11.3 Feedback Visual e Sonoro (UX)

Para aumentar o engajamento, foram adicionados:
- **Caixas Neon:** Ao atingir um objetivo, a caixa troca o gradiente laranja por um roxo/neon pulsante (`box-neon-pulse`).
- **Partículas de Brilho:** Efeito `sparkle-effect` disparado via JS na célula alvo ao completar um encaixe.
- **Audio de Sucesso:** `playSuccessSound` (acorde harmônico em 880Hz/1320Hz) complementa o feedback tátil.

---

## 12. Glossário de Termos do Projeto

| Termo | Definição |
|---|---|
| **Shell** | A Activity Android que envolve o WebView |
| **AssetLoader** | `WebViewAssetLoader` — serve arquivos de `assets/` sob domínio `https://appassets.androidplatform.net` |
| **Insets** | Espaços reservados pelo sistema (status bar, navigation bar, notch) reportados via `WindowInsetsCompat` |
| **dvh** | Dynamic Viewport Height — unidade CSS que exclui a barra de endereços e barras do SO |
| **EdgeToEdge** | Modo onde o conteúdo do app se estende atrás das barras do sistema |
| **PRNG** | Pseudo-Random Number Generator — `createRng(seed)` usa Mulberry32 para geração determinística de fases |
| **Deadlock** | Posição de caixa em canto sem objetivo — o jogo bloqueia esse movimento preventivamente |
| **phaseEntryScore** | Pontuação no momento de início da fase, usada como "combustível" na prorrogação |
| **Overtime / Prorrogação** | Período após o tempo principal (60 s) onde a pontuação acumulada é consumida em até 24 s |
