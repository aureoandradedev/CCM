# Guia de Desenvolvimento — CCM

Este documento descreve o fluxo de trabalho Git da equipe. **Leia antes de
começar a programar.**

## Branches utilizadas

| Branch          | Papel                                          |
|-----------------|------------------------------------------------|
| `main`          | Versão integrada e estável. **Não se programa aqui.** |
| `feature/aureo` | Branch de desenvolvimento do **Áureo**.        |
| `feature/pedro` | Branch de desenvolvimento do **Pedro**.        |

- **Áureo** trabalha **exclusivamente** em `feature/aureo`.
- **Pedro** trabalha **exclusivamente** em `feature/pedro`.
- **Ninguém** faz commits diretamente na `main`.

## Regra de ouro: confira a branch antes de alterar qualquer código

```bash
git branch --show-current
```

- Se você é o **Áureo**, o resultado deve ser `feature/aureo`.
- Se você é o **Pedro**, o resultado deve ser `feature/pedro`.

Se estiver na branch errada, **corrija antes** de qualquer alteração:

```bash
git switch feature/aureo   # Áureo
git switch feature/pedro   # Pedro
```

## Configuração inicial (primeira vez que o Pedro conecta)

```bash
# 1. Clonar o repositório
git clone <URL_DO_REPOSITORIO>
cd CCM

# 2. Buscar todas as branches remotas
git fetch origin

# 3. Entrar na sua branch (cria o rastreamento local -> remoto)
git switch feature/pedro

# 4. Confirmar
git branch --show-current   # deve mostrar: feature/pedro
```

## Como enviar seus commits (dia a dia)

```bash
# 1. Confira que está na sua branch
git branch --show-current

# 2. Veja o que mudou
git status

# 3. Adicione e faça o commit
git add .
git commit -m "descrição clara do que foi feito"

# 4. Envie para o remoto (primeira vez usa -u para criar rastreamento)
git push            # se a branch já rastreia o remoto
# ou, na primeira vez:
git push -u origin feature/pedro
```

## Como atualizar sua branch com o que está na `main`

Faça isso periodicamente para reduzir conflitos futuros:

```bash
# 1. Garanta que está na sua branch e que seu trabalho está commitado
git branch --show-current
git status

# 2. Traga as novidades do remoto
git fetch origin

# 3. Traga as mudanças da main para a sua branch
git merge origin/main

# 4. Resolva conflitos (se houver), depois:
git add .
git commit          # conclui o merge, se necessário
git push
```

## Como evitar trabalhar na branch errada

- **Sempre** rode `git branch --show-current` antes de editar.
- Configure o prompt do terminal para exibir a branch atual (opcional).
- Nunca use `git switch main` para desenvolver — a `main` é só para integração.
- Em caso de dúvida, pare e confira antes de commitar.

## Integração entre desenvolvedores (feita de forma controlada)

**Nunca** faça merge automático entre `feature/aureo` e `feature/pedro`, e
**nunca** sobrescreva o código do outro silenciosamente. O processo é:

```bash
# 1. Verificar as diferenças entre as branches
git fetch origin
git diff origin/feature/aureo..origin/feature/pedro

# 2. Verificar possíveis conflitos antes de integrar (merge de teste, sem commit)
git switch main
git merge --no-commit --no-ff origin/feature/aureo
#   -> revise; se quiser abortar o teste:
git merge --abort

# 3. Informar/combinar o que será integrado (com o outro dev)

# 4. Integrar de forma controlada na main
git switch main
git merge origin/feature/aureo    # integra o Áureo
git merge origin/feature/pedro    # integra o Pedro (resolvendo conflitos)

# 5. Testar o resultado integrado

# 6. Só depois, publicar a main
git push origin main
```

Após a `main` ser atualizada, cada dev traz as novidades para a sua branch
usando o passo **"Como atualizar sua branch com o que está na main"** acima.

## Resumo rápido

| Ação                         | Comando                               |
|------------------------------|---------------------------------------|
| Ver branch atual             | `git branch --show-current`           |
| Trocar de branch             | `git switch <branch>`                 |
| Ver mudanças                 | `git status`                          |
| Commitar                     | `git add .` + `git commit -m "..."`   |
| Enviar                       | `git push`                            |
| Atualizar a partir da main   | `git fetch origin` + `git merge origin/main` |
