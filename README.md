# CCM

> Projeto em fase de fundação técnica. A definição funcional (o que o CCM faz)
> ainda será especificada. Este README será atualizado quando o escopo e a
> stack forem definidos.

## Objetivo

_A definir._ O escopo funcional do CCM ainda não foi especificado. Nenhuma
funcionalidade foi implementada ou assumida até este momento — apenas a
fundação técnica (estrutura de pastas, Git e fluxo de trabalho da equipe).

## Stack

_A definir._ Nenhuma tecnologia foi escolhida ainda. A stack será selecionada
com base nos requisitos funcionais, evitando dependências desnecessárias.

## Como instalar

_A definir após a escolha da stack._ Os passos de instalação (ex.: instalação
de dependências) serão documentados aqui assim que houver stack.

```bash
# Exemplo (será ajustado conforme a stack):
# git clone <URL_DO_REPOSITORIO>
# cd CCM
# <comando de instalação de dependências>
```

## Como executar

_A definir após a escolha da stack._

```bash
# Exemplo (será ajustado conforme a stack):
# <comando para rodar o projeto>
```

## Variáveis necessárias

As variáveis de ambiente ficam em um arquivo `.env` (não versionado).
Use o [`.env.example`](.env.example) como modelo:

```bash
cp .env.example .env
```

Ainda não há variáveis reais definidas — o `.env.example` é apenas um
placeholder inicial.

## Estrutura básica

```
CCM/
├── docs/            # Documentação do projeto
│   └── DEVELOPMENT.md   # Guia de desenvolvimento e fluxo Git da equipe
├── src/             # Código-fonte (a ser preenchido conforme a stack)
├── .env.example     # Modelo de variáveis de ambiente
├── .gitignore
└── README.md
```

## Fluxo Git da equipe

O projeto é desenvolvido por duas pessoas em paralelo:

| Branch          | Responsável | Uso                                    |
|-----------------|-------------|----------------------------------------|
| `main`          | —           | Versão integrada/estável               |
| `feature/aureo` | Áureo       | Desenvolvimento do Áureo               |
| `feature/pedro` | Pedro       | Desenvolvimento do Pedro               |

**Regras:**

- Ninguém desenvolve diretamente na `main`.
- Áureo trabalha **somente** em `feature/aureo`.
- Pedro trabalha **somente** em `feature/pedro`.
- Antes de qualquer alteração, verifique a branch atual:
  ```bash
  git branch --show-current
  ```
- Integração entre as branches é feita de forma **controlada** (nunca merge
  automático). Detalhes em [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

Consulte [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) para o guia completo de
desenvolvimento (comandos, atualização de branch, envio de commits e
integração).
