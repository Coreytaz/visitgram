# Подробная инструкция по запуску Visitgram

Инструкция относится к текущему Node.js-приложению из этого репозитория.
Оно принимает события сайта по HTTP, хранит их в одной выбранной БД и отправляет
уведомления в Telegram. Веб-панели нет. Запускайте один процесс приложения:
Telegram polling, очередь и миграции рассчитаны на такой режим.

## 1. Что подготовить

- Node.js не ниже 24.5 и npm; версии проверьте командами `node --version` и
  `npm --version`.
- Исходники проекта, включая `package-lock.json`, `src/`, `public/`, `scripts/`
  и SQL-миграции в `drizzle/` (проверка описана ниже).
- Для серверной СУБД — работающий сервер или облачный SQL endpoint, доступный
  с компьютера приложения, и административный доступ для создания базы/пользователя.
  Устанавливать все СУБД одновременно не нужно.
- Для уведомлений — токен бота от @BotFather и числовой ID владельца личного чата.
  Напишите боту `/start`. Если обе переменные Telegram пустые, HTTP-трекер
  может работать без бота.
- Для реального сайта — публичный HTTPS-адрес трекера и прокси до порта приложения.
  Для локальной проверки достаточно `http://localhost:3000`.

Команды npm выполняйте из корня проекта. SQL выполняйте в клиенте выбранной
СУБД, а не в PowerShell или Bash. Пароли `REPLACE_WITH_STRONG_PASSWORD` в
примерах замените своими. Административные SQL-команды рассчитаны на новую
установку: повторный `CREATE DATABASE` для уже существующей базы завершится ошибкой.

## 2. Установка зависимостей и окружение

PowerShell (Windows):

```powershell
Set-Location D:\project\analog
npm ci
Copy-Item .env.example .env.local
```

Bash (Linux/macOS), после перехода в каталог проекта:

```bash
npm ci
cp .env.example .env.local
chmod 600 .env.local
```

Копируйте шаблон только при первой установке: существующий `.env.local`
содержит ваши настройки. Откройте его в редакторе. Общие параметры:

```dotenv
VISITGRAM_PORT_SERVER="3000"
VISITGRAM_PUBLIC_URL="http://localhost:3000"
VISITGRAM_TOKEN="REPLACE_WITH_RANDOM_ADMIN_TOKEN"
VISITGRAM_TRACK_RETENTION_DAYS="30"
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
TELEGRAM_LOCALE="ru"
```

Сгенерируйте административный токен:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Для Telegram заполните обе переменные `TELEGRAM_BOT_TOKEN` и
`TELEGRAM_CHAT_ID`. Для публикации замените `VISITGRAM_PUBLIC_URL` на HTTPS-origin
без пути, например `https://analytics.example.com`. Секреты не добавляйте в Git.

При выборе БД меняйте существующие строки в `.env.local`, не добавляя дубликаты.
`VISITGRAM_DB_DIALECT` по умолчанию равен `sqlite`. Непустой `VISITGRAM_DATABASE_URL`
имеет приоритет над `VISITGRAM_SQLITE_URL`. Для всех диалектов, кроме `sqlite`,
`VISITGRAM_DATABASE_URL` обязателен.

Пароли в URL должны быть URL-кодированы: например, `@` → `%40`, `#` → `%23`,
`/` → `%2F`, `%` → `%25`. В SQL используйте исходный пароль; одинарную кавычку
в SQL-строке экранируйте удвоением. Примеры ниже используют пароль без специальных
символов, чтобы показать структуру подключения.

## 3. Что создаётся автоматически

Администратор создаёт базу, пользователя и права. Приложение создаёт таблицы,
индексы и ограничения через подготовленные SQL-миграции. Ручной `CREATE TABLE`
для таблиц приложения не нужен.

Термин «схема» здесь имеет два значения:

- Структура данных — таблицы и индексы. Её создаёт `npm run db:migrate`.
- Пространство имён SQL — например, `public` в PostgreSQL или `dbo` в MSSQL.
  Для примеров ниже используйте именно эти стандартные пространства имён.
  В MySQL/SingleStore `CREATE SCHEMA` — другое название `CREATE DATABASE`;
  у SQLite/libSQL отдельное пространство имён создавать не нужно.

Отдельной переменной `VISITGRAM_DB_SCHEMA` в приложении нет. Имена таблиц в коде
не квалифицированы схемой. Произвольная схема требует согласовать путь поиска,
DDL миграций и проверки метаданных; простого `CREATE SCHEMA analytics` недостаточно.

### Проверка наличия миграций

В поставке должны быть каталоги вида
`drizzle/<диалект>/<имя_миграции>/migration.sql`. Для libSQL используется
`drizzle/sqlite/`. Наличие TypeScript-файлов в `src/services/database/schema/`
не заменяет SQL-миграции.

PowerShell:

```powershell
Get-ChildItem drizzle -Recurse -Filter migration.sql
```

Bash:

```bash
find drizzle -name migration.sql
```

Если `drizzle/` отсутствует в исходниках новой установки, сначала подготовьте
начальную миграцию для выбранного диалекта. После настройки его переменных в
`.env.local` выполните:

```bash
npm run db:generate -- --name=initial
```

Эта команда создаёт файлы, но не применяет их к БД. Она также перегенерирует
TypeScript-схемы всех диалектов из `scripts/schema-generate.mjs`. Проверьте SQL
и сохраните миграции вместе с исходниками. Для поставки со всеми СУБД повторите
генерацию для `sqlite`, `postgresql`, `mysql`, `singlestore`, `mssql`,
`cockroachdb`, каждый раз выбирая диалект и соответствующий URL в окружении.
Отдельная генерация для `libsql` не требуется.

Для существующей базы восстановите исходную историю миграций из той же версии
проекта. Не заменяйте потерянную историю новой начальной миграцией.

## 4. SQLite: локальный файл

Сервер БД, SQL-пользователь и ручное создание схемы не нужны.

```dotenv
VISITGRAM_DB_DIALECT="sqlite"
VISITGRAM_DATABASE_URL=""
VISITGRAM_SQLITE_URL="file:./analytics.db"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

Путь отсчитывается от рабочего каталога процесса. Запускайте команды из корня
проекта, чтобы случайно не создать другую БД. Для абсолютного пути можно
использовать `file:/var/lib/analog/analytics.db` или
`file:///D:/data/analog/analytics.db`. Родительский каталог создайте заранее;
пользователь процесса должен иметь права на запись в каталог и файл.

После проверки миграций выполните:

```bash
npm run db:migrate
npm start
```

Файл создаётся при подключении, таблицы — при миграции. Если установлен CLI
`sqlite3`, проверить результат можно так:

```bash
sqlite3 analytics.db ".tables"
sqlite3 analytics.db "SELECT name FROM app_migrations ORDER BY name;"
```

## 5. libSQL / Turso

Для локального libSQL можно использовать `VISITGRAM_DB_DIALECT="libsql"` и
`VISITGRAM_DATABASE_URL="file:./analytics.db"`. Для удалённого сервиса сначала
создайте базу в панели провайдера и получите SQL URL и токен с правами записи
и изменения структуры. Токен только для чтения не подходит.

Пример создания через установленный Turso CLI:

```bash
turso auth login
turso db create analog
turso db show analog --url
turso db tokens create analog
```

Вывод последних двух команд перенесите в `.env.local`:

```dotenv
VISITGRAM_DB_DIALECT="libsql"
VISITGRAM_DATABASE_URL="libsql://YOUR_DATABASE.turso.io"
VISITGRAM_DATABASE_AUTH_TOKEN="REPLACE_WITH_DATABASE_TOKEN"
```

Примените миграции и запустите приложение:

```bash
npm run db:migrate
npm start
```

Проверка через `turso db shell analog`:

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
SELECT name FROM app_migrations ORDER BY name;
```

Команды создания базы описаны в [официальном репозитории Turso CLI](https://github.com/tursodatabase/turso-cli).

## 6. PostgreSQL

Подключитесь администратором, например `psql -h localhost -U postgres -d postgres`.
Выполните вне блока транзакции:

```sql
CREATE ROLE analog_app LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE analog OWNER analog_app;
```

Переключитесь в созданную БД (`\connect analog` в psql), затем выполните:

```sql
GRANT CONNECT ON DATABASE analog TO analog_app;
GRANT USAGE, CREATE ON SCHEMA public TO analog_app;
ALTER ROLE analog_app IN DATABASE analog SET search_path = public;
```

`public` уже существует в обычной новой БД. Восстанавливать её через
`CREATE SCHEMA public AUTHORIZATION analog_app` нужно только если администратор
ранее удалил эту схему. Право создавать объекты в схеме отличается от права
подключаться к базе — см. [документацию PostgreSQL](https://www.postgresql.org/docs/18/ddl-schemas.html).

```dotenv
VISITGRAM_DB_DIALECT="postgresql"
VISITGRAM_DATABASE_URL="postgresql://analog_app:REPLACE_WITH_STRONG_PASSWORD@localhost:5432/analog"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

Для удалённой базы используйте URL и TLS-параметры провайдера; локальный пример
не задаёт TLS. Приложению нужен обычный SQL endpoint с поддержкой транзакций.

```bash
npm run db:migrate
npm start
```

Подключившись именно как `analog_app` к `analog`, проверьте:

```sql
SELECT current_database(), current_user, current_schema();
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT name FROM app_migrations ORDER BY name;
```

## 7. MySQL

Подключитесь администратором, например `mysql -h 127.0.0.1 -u root -p`:

```sql
CREATE DATABASE analog CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'analog_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON analog.* TO 'analog_app'@'localhost';
```

Эти права ограничены базой `analog` и позволяют применять миграции. Для приложения
на другом компьютере замените `localhost` в обеих SQL-командах на разрешённый
адрес источника подключения. В контейнерной сети адрес источника также может
отличаться от `localhost`. `FLUSH PRIVILEGES` после `CREATE USER`/`GRANT` не нужен.
Создание учётных записей описано в [документации MySQL](https://dev.mysql.com/doc/refman/8.4/en/create-user.html).

```dotenv
VISITGRAM_DB_DIALECT="mysql"
VISITGRAM_DATABASE_URL="mysql://analog_app:REPLACE_WITH_STRONG_PASSWORD@localhost:3306/analog"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

```bash
npm run db:migrate
npm start
```

В SQL-клиенте пользователя приложения:

```sql
USE analog;
SELECT DATABASE(), CURRENT_USER();
SHOW TABLES;
SELECT name FROM app_migrations ORDER BY name;
```

## 8. SingleStore

Подготовьте рабочую БД в SingleStore и SQL endpoint агрегатора. Подключитесь
администратором через совместимый MySQL-клиент. Для новой базы:

```sql
CREATE DATABASE analog;
CREATE USER 'analog_app'@'%' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX
ON analog.* TO 'analog_app'@'%';
```

`%` допускает любой источник на уровне SQL-пользователя; ограничьте сетевой доступ
настройками сервиса. Права и доступ к метаданным зависят от конфигурации SingleStore;
проверьте их по [матрице разрешений](https://docs.singlestore.com/db/v8.9/reference/sql-reference/security-management-commands/permissions-matrix/).
Мигратор читает `information_schema.tables` и `information_schema.statistics`.
Если политика кластера ограничивает видимость метаданных, администратор должен
настроить её для миграций; у SingleStore есть отдельное глобальное право
[`SHOW METADATA`](https://support.singlestore.com/hc/en-us/articles/360060061892-Grants-to-access-the-information-schema-database).

```dotenv
VISITGRAM_DB_DIALECT="singlestore"
VISITGRAM_DATABASE_URL="mysql://analog_app:REPLACE_WITH_STRONG_PASSWORD@YOUR_HOST:3306/analog"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

Для облачного endpoint настройте TLS согласно требованиям сервиса и `mysql2`.
Используйте диалект `singlestore`, даже несмотря на протокол `mysql://`:
ему соответствуют собственные схемы и миграции.

```bash
npm run db:migrate
npm start
```

Проверка: `USE analog;`, затем `SHOW TABLES;` и
`SELECT name FROM app_migrations ORDER BY name;`.

## 9. Microsoft SQL Server (MSSQL)

Для примера нужен SQL Server с включённой SQL-аутентификацией и доступным TCP-портом.
В SSMS или `sqlcmd` подключитесь администратором и выполните:

```sql
USE master;
GO
CREATE DATABASE analog;
GO
CREATE LOGIN analog_app WITH PASSWORD = 'REPLACE_WITH_STRONG_PASSWORD';
GO
USE analog;
GO
CREATE USER analog_app FOR LOGIN analog_app WITH DEFAULT_SCHEMA = dbo;
GRANT CONNECT TO analog_app;
GRANT CREATE TABLE TO analog_app;
GRANT ALTER, SELECT, INSERT, UPDATE, DELETE, REFERENCES
ON SCHEMA::dbo TO analog_app;
GO
```

Замените пароль на соответствующий политике SQL Server. `GO` — разделитель
пакетов SSMS/sqlcmd, а не SQL-оператор для произвольного драйвера.
Схема `dbo` существует в новой БД. Для создания таблиц нужны права базы
и схемы — см. [документацию Microsoft](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-schema-transact-sql).
Пример предназначен для SQL Server; создание логина в Azure SQL может требовать
другой административной процедуры.

```dotenv
VISITGRAM_DB_DIALECT="mssql"
VISITGRAM_DATABASE_URL="mssql://analog_app:REPLACE_WITH_STRONG_PASSWORD@YOUR_HOST:1433/analog?encrypt=true"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

Сертификат должен быть доверенным и соответствовать имени сервера. Для локальной
разработки с самоподписанным сертификатом поддерживается строка подключения:

```dotenv
VISITGRAM_DATABASE_URL="Server=localhost,1433;Database=analog;User Id=analog_app;Password=REPLACE_WITH_STRONG_PASSWORD;Encrypt=true;TrustServerCertificate=true"
```

`TrustServerCertificate=true` отключает проверку сертификата; используйте этот
вариант только для локальной проверки. Здесь пароль задаётся в формате строки
подключения MSSQL, а не URL.

```bash
npm run db:migrate
npm start
```

Проверка в базе `analog` под пользователем приложения:

```sql
SELECT DB_NAME() AS database_name, USER_NAME() AS user_name;
SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;
SELECT name FROM dbo.app_migrations ORDER BY name;
```

## 10. CockroachDB

Для защищённого кластера получите административный SQL URL и сертификаты по
инструкции вашего провайдера. Подключитесь через `cockroach sql --url=...`
или совместимый PostgreSQL-клиент. Администратором выполните:

```sql
CREATE USER analog_app WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE analog;
GRANT ALL ON DATABASE analog TO analog_app;
USE analog;
GRANT ALL ON SCHEMA public TO analog_app;
ALTER ROLE analog_app IN DATABASE analog SET search_path = public;
```

Пользователю нужны права создавать таблицы в `public` и читать/менять созданные
им объекты. Используйте отдельную базу для приложения.
См. команды [GRANT](https://docs.cockroachlabs.com/docs/stable/grant) и
[ALTER ROLE](https://docs.cockroachlabs.com/docs/stable/alter-role) в документации CockroachDB.

```dotenv
VISITGRAM_DB_DIALECT="cockroachdb"
VISITGRAM_DATABASE_URL="postgresql://analog_app:REPLACE_WITH_STRONG_PASSWORD@YOUR_HOST:26257/analog?sslmode=verify-full"
VISITGRAM_DATABASE_AUTH_TOKEN=""
```

Если кластер использует собственный CA, добавьте в URL путь `sslrootcert`,
например `&sslrootcert=/path/to/root.crt`, кодируя специальные символы пути.
URL должен соответствовать режиму аутентификации кластера. `sslmode=disable`
допустим только для отдельного локального insecure-кластера.

```bash
npm run db:migrate
npm start
```

Проверка:

```sql
SELECT current_database(), current_user, current_schema();
SHOW TABLES FROM analog.public;
SELECT name FROM app_migrations ORDER BY name;
```

## 11. Общая проверка после запуска

При успешной миграции команда выводит `Database migrations complete (<диалект>)`.
При запуске сервера ожидается `Visitgram is running on port 3000`.
`npm start` также применяет миграции автоматически до открытия HTTP-порта;
отдельный вызов `db:migrate` удобен для предварительной проверки.

Оставив сервер работающим, откройте второй терминал.

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Bash:

```bash
curl -fsS http://localhost:3000/health
```

Ответ: `{"status":"ok"}`. Он подтверждает запуск HTTP после инициализации БД,
но не проверяет текущую доступность БД и доставку Telegram.

После миграции должны существовать таблицы:

| Таблица                    | Назначение                             |
| -------------------------- | -------------------------------------- |
| `sites`                    | Сайты и шаблоны уведомлений            |
| `site_origins`             | Разрешённые origin сайтов              |
| `site_event_notifications` | Настройки уведомлений по типам событий |
| `tracking_events`          | События и очередь доставки             |
| `site_visitors`            | Посетители сайтов                      |
| `visitor_sessions`         | Сессии посетителей                     |
| `bot_preferences`          | Язык владельца                         |
| `bot_input`                | Состояние ввода в Telegram             |
| `app_migrations`           | История применения миграций            |

Откройте `/menu` в личном чате владельца, добавьте сайт с точным origin
(например, `https://example.com`) и получите «Код трекера». Вставьте выданный
скрипт на сайт. Публичный `site_id` не заменяет проверку origin. Откройте страницу
сайта и проверьте статистику и уведомление о просмотре. DNT/GPC браузера отключают
сбор событий. Подробности установки скрипта и API находятся в [README](../README.md).

На сервере настройте запуск из корня проекта от отдельного системного пользователя
и перезапуск при сбоях через менеджер процессов вашей ОС. Прокси должен направлять
HTTPS-запросы к приложению и сохранять заголовок `Origin`. Входящий webhook Telegram
не нужен; необходим исходящий доступ к Telegram и выбранной БД.

## 12. Изменение схемы, обновление и резервная копия

Для обычного обновления остановите процесс, сохраните резервную копию БД,
обновите исходники вместе с `drizzle/`, выполните `npm ci`, `npm run db:migrate`
и `npm start`. Не запускайте миграции параллельно с другим экземпляром приложения.

SQLite копируйте при полностью остановленном приложении; если остались
`analytics.db-wal` и `analytics.db-shm`, не отбрасывайте их при создании копии.
Для серверной СУБД используйте её штатный согласованный backup/snapshot и проверьте
восстановление в отдельную БД. Простое копирование файлов работающего сервера
не заменяет резервную копию.

Если вы разрабатываете изменение структуры:

1. Измените описание колонок в `scripts/schema-generate.mjs`.
2. Выберите диалект и URL в `.env.local`.
3. Выполните `npm run db:generate -- --name=describe_change`.
4. Просмотрите SQL и снимки в `drizzle/<диалект>/`; проверьте изменение на копии БД.
5. Повторите генерацию для каждого поддерживаемого диалекта (libSQL использует SQLite).
6. Сохраните сгенерированные схемы и миграции в Git и поставляйте их вместе с кодом.

Применённые SQL-файлы не меняйте: приложение проверяет контрольные суммы.
`drizzle-kit push` не используйте для обновления установки. Автоматического отката
миграций и переноса данных между СУБД нет. Смена URL на пустую БД создаст новую
структуру, но не перенесёт события, сайты и настройки. Для возврата после
неудачного обновления восстанавливайте согласованные версии кода и резервной копии.

## 13. Если запуск не удался

| Симптом                                      | Что проверить                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Нет `.env.local`                             | Создайте его из шаблона; `npm start` требует этот файл.                                                        |
| `Unsupported VISITGRAM_DB_DIALECT`           | Используйте точное значение из раздела выбранной БД.                                                           |
| `Set VISITGRAM_DATABASE_URL...`              | Для выбранного диалекта URL обязателен; проверьте пустое значение.                                             |
| `Database initialization failed...`          | Сервер, порт, сеть, пароль, URL-кодирование, TLS и имя БД; подключитесь тем же пользователем через SQL-клиент. |
| `Database migration failed...`               | Наличие `drizzle/<диалект>/`, права DDL и метаданных; проверяйте на копии БД.                                  |
| Ошибка сертификата                           | Имя хоста, доверенный CA, параметры TLS и срок сертификата.                                                    |
| Нет таблиц или они в другой схеме            | Фактическая БД, `search_path`/`DEFAULT_SCHEMA`, приоритет `VISITGRAM_DATABASE_URL`, рабочий каталог SQLite.    |
| `An applied database migration was modified` | Восстановите исходный SQL-файл; не удаляйте строки журнала для обхода проверки.                                |
| Порт занят                                   | Остановите другой процесс или задайте другой `VISITGRAM_PORT_SERVER`.                                          |
| `/health` работает, бот не отвечает          | Обе переменные Telegram, ID владельца, личный чат, исходящий доступ, отсутствие второго polling-процесса.      |
| События не поступают                         | URL скрипта, публичный HTTPS-адрес, `site_id`, origin, пауза сайта, DNT/GPC.                                   |

Приложение намеренно скрывает детали подключения в ошибках. Не публикуйте полный
URL с паролем или токеном при диагностике. При ошибке миграции HTTP-сервер
не запускается.
