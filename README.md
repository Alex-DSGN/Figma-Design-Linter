# Design Linter (Figma Plugin)

Плагин для Figma. Проверяет дизайн на соблюдение правил дизайн-системы.

## Проверки
- Цвета: заливки/обводки/фон фрейма должны использовать Style или Variable
- Контраст текста (WCAG AA)
- Текст: наличие Text Style
- Эффекты: использование Effect Style
- Неиспользуемые Color Styles

## Сборка
```bash
npm install
npm run build
```

## Запуск в Figma
1. Figma Desktop → `Plugins` → `Development` → `Import plugin from manifest...`
2. Выберите `manifest.json` в корне проекта.
3. Запустите: `Plugins` → `Development` → `Design Linter`.