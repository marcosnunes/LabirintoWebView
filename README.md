# Labirinto

**Labirinto** é um jogo de quebra-cabeça clássico no estilo Sokoban, onde o objetivo é empurrar caixas estrategicamente até os pontos de entrega para liberar o caminho. O jogo foi desenvolvido utilizando uma arquitetura híbrida, unindo a performance de um aplicativo Android nativo com a flexibilidade de uma interface moderna em React.

## 🕹️ O Jogo

Desafie seu raciocínio lógico através de centenas de níveis. Cada movimento conta: empurre as caixas para os locais corretos antes que o tempo se esgote! Se o tempo principal acabar, você entra na **Prorrogação**, onde sua pontuação acumulada é consumida para te dar alguns segundos extras de fôlego.

### Principais Características:
- **200 Fases Únicas**: Uma progressão de dificuldade balanceada para testar suas habilidades.
- **Sistema de Pontuação**: Bônus por rapidez e eficiência de movimentos.
- **Trilha Sonora Relaxante**: Playlist integrada com sistema de shuffle e transições suaves.
- **Design Responsivo**: Adaptado para celulares e tablets, com suporte a modo retrato, paisagem e visualizações em tela cheia.
- **Estética Retrô**: Filtro CRT overlay para uma experiência nostálgica.
- **Salvamento Automático**: Seu progresso, pontuação e configurações são salvos localmente no dispositivo.

## 🛠️ Tecnologias Utilizadas

Este projeto demonstra a implementação de uma **WebView de alto desempenho** em Android:

- **Android (Java)**:
    - Implementação de `WebViewAssetLoader` para carregamento seguro e rápido de assets locais via HTTPS.
    - Comunicação bidirecional (JS Bridge) para tratamento de `WindowInsets` (Safe Area) e navegação física.
    - Otimização de playback de mídia sem necessidade de interação prévia do usuário.
- **Frontend (React + Vite)**:
    - Lógica de jogo baseada em hooks personalizados para gerenciamento de estado e colisões.
    - Renderização otimizada de mapas e sprites.
    - Manipulação direta da API de Áudio do HTML5 para a trilha sonora.
- **Segurança**: Configurações de `signingConfigs` protegidas e políticas de privacidade rigorosas (zero coleta de dados).

## 📄 Política de Privacidade

O Labirinto preza pela privacidade total. Não coletamos dados pessoais nem rastreamos o uso do aplicativo. Todas as informações de jogo permanecem exclusivamente no armazenamento local do seu aparelho.

---
*Desenvolvido como um projeto de demonstração de integração Web-Native.*