# Labirinto

Jogo estilo Sokoban feito com React + Vite, com fases procedurais, cronometro por fase e persistencia local.

## Persistencia local

O jogo salva automaticamente o progresso no `localStorage` do navegador (chave `labirinto-save-v1`) e retoma da ultima sessao ao abrir novamente.

Itens persistidos:
- campanha gerada
- fase atual e estado do tabuleiro
- pontuacao acumulada
- tempo atual da fase (incluindo prorrogacao)
- estados de vitoria/derrota

## Scripts

- `npm run dev`: sobe o servidor Vite
- `npm run build`: gera build web em `dist`
- `npm run build:android`: gera `dist` e copia para `android-webview/app/src/main/assets/www`
- `npm run lint`: valida ESLint

## Android Studio (WebView)

A raiz do workspace (`V1`) agora e um projeto Android valido (app em Java) para abrir direto no Android Studio.

### Fluxo recomendado

1. Na pasta do jogo, rode:
	- `npm install`
	- `npm run build:android`
2. Abra a pasta raiz `V1` no Android Studio.
3. Aguarde o Gradle sync.
4. Rode o app em emulador/dispositivo.

O `MainActivity` do modulo `app` (na raiz) carrega:
- `file:///android_asset/www/index.html`

Entao, sempre que mudar o jogo web, execute novamente `npm run build:android` antes de testar no Android.

## Estrutura principal

- `src/App.jsx`: logica do jogo e persistencia
- `src/App.css`: tema e layout
- `android-webview/`: app Android WebView
- `scripts/copy-dist-to-android.cjs`: copia build web para assets Android
