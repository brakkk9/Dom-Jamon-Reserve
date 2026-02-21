"""
Dom Jamon — Reservation Bot
"""

import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TOKEN              = os.environ.get("BOT_TOKEN", "8502174576:AAEYcRBjYvGkvd61cXolURx2XlRsmtd9pTg")
PREORDER_WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://dom-jamon-reserve.vercel.app/preorder")
PREORDERS_FILE     = Path("preorders.json")

logging.basicConfig(
    format="%(asctime)s  %(levelname)s  %(name)s — %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------

NAME, GUESTS, DATE, TIME, PREORDER, COMMENT, CONFIRM = range(7)

# ---------------------------------------------------------------------------
# Preorder storage
# ---------------------------------------------------------------------------

def save_reservation(data: dict) -> None:
    """Append a completed reservation to preorders.json."""
    record = {
        "saved_at":  datetime.now().isoformat(timespec="seconds"),
        "name":      data.get("name"),
        "guests":    data.get("guests"),
        "date":      data.get("date"),
        "time":      data.get("time"),
        "preorder":  data.get("preorder_items"),
        "comment":   data.get("comment"),
    }

    records = []
    if PREORDERS_FILE.exists():
        try:
            records = json.loads(PREORDERS_FILE.read_text(encoding="utf-8"))
        except Exception:
            records = []

    records.append(record)
    PREORDERS_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Reservation saved: %s", record)

# ---------------------------------------------------------------------------
# Keyboard builders
# ---------------------------------------------------------------------------

def date_keyboard() -> ReplyKeyboardMarkup:
    today = datetime.today()
    start = 0 if today.hour < 21 else 1
    buttons, row = [], []
    for i in range(start, start + 7):
        day   = today + timedelta(days=i)
        label = day.strftime("%d.%m") + (" (сьогодні)" if i == 0 else "")
        row.append(label)
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return ReplyKeyboardMarkup(buttons, one_time_keyboard=True, resize_keyboard=True)


def preorder_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(
            "Передзамовити страви",
            web_app=WebAppInfo(url=PREORDER_WEBAPP_URL),
        )],
        [InlineKeyboardButton("Пропустити", callback_data="skip_preorder")],
    ])


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Все вірно!", callback_data="confirm_yes")],
        [
            InlineKeyboardButton("Ім'я",    callback_data="edit_name"),
            InlineKeyboardButton("Гості",   callback_data="edit_guests"),
        ],
        [
            InlineKeyboardButton("Дата",    callback_data="edit_date"),
            InlineKeyboardButton("Час",     callback_data="edit_time"),
        ],
        [
            InlineKeyboardButton("Передзамовлення", callback_data="edit_preorder"),
            InlineKeyboardButton("Коментар",        callback_data="edit_comment"),
        ],
    ])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def summary(data: dict) -> str:
    comment  = data.get("comment") or "—"
    items    = data.get("preorder_items")

    if items:
        preorder_lines = "\n".join(
            f"  • {i['name']}"
            + (f" ({i['option']})" if i.get("option") else "")
            + f" ×{i['qty']}  —  {i['price'] * i['qty']} ₴"
            for i in items
        )
        total         = sum(i["price"] * i["qty"] for i in items)
        preorder_str  = f"\n{preorder_lines}\n  Разом: {total} ₴"
    else:
        preorder_str = "—"

    return (
        f"Ім'я: {data.get('name')}\n"
        f"Гості: {data.get('guests')}\n"
        f"Дата: {data.get('date')}\n"
        f"Час: {data.get('time')}\n"
        f"Передзамовлення:{preorder_str}\n"
        f"Коментар: {comment}\n"
    )


async def send(context: ContextTypes.DEFAULT_TYPE, chat_id: int, **kwargs) -> None:
    await context.bot.send_message(chat_id=chat_id, **kwargs)

# ---------------------------------------------------------------------------
# Handlers — reservation flow
# ---------------------------------------------------------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text(
        "Вітаємо в *Dom Jamon*!\n\nЯ допоможу вам зарезервувати стіл. Почнімо!\n\nЯк вас *звати*?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardRemove(),
    )
    return NAME


async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["name"] = update.message.text.strip()
    await update.message.reply_text(
        f"Радий знайомству, *{context.user_data['name']}*!\n\nСкільки людей очікується?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [["1", "2", "3", "4"], ["5", "6", "7", "8+"]],
            one_time_keyboard=True,
            resize_keyboard=True,
        ),
    )
    return GUESTS


async def get_guests(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["guests"] = update.message.text.strip()
    await update.message.reply_text(
        "Оберіть *дату* резервації:",
        parse_mode="Markdown",
        reply_markup=date_keyboard(),
    )
    return DATE


async def get_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["date"] = update.message.text.strip()
    await update.message.reply_text(
        "Тепер оберіть *час*:",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [
                ["12:00", "13:00", "14:00"],
                ["15:00", "16:00", "17:00"],
                ["18:00", "19:00", "20:00"],
                ["21:00", "22:00"],
            ],
            one_time_keyboard=True,
            resize_keyboard=True,
        ),
    )
    return TIME


async def get_time(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["time"] = update.message.text.strip()
    await update.message.reply_text(
        "Бажаєте *передзамовити страви* заздалегідь?\n\nНатисніть кнопку нижче щоб відкрити меню, або пропустіть цей крок.",
        parse_mode="Markdown",
        reply_markup=preorder_keyboard(),
    )
    return PREORDER


# WebApp sends data automatically when tg.sendData() is called
async def preorder_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    raw = update.effective_message.web_app_data.data
    try:
        payload = json.loads(raw)
        if payload.get("action") == "preorder" and payload.get("items"):
            context.user_data["preorder_items"] = payload["items"]
        else:
            context.user_data["preorder_items"] = None
    except Exception:
        context.user_data["preorder_items"] = None

    await ask_comment(update.effective_message.chat_id, context)
    return COMMENT


async def preorder_skip(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    await query.edit_message_reply_markup(reply_markup=None)
    context.user_data["preorder_items"] = None
    await ask_comment(query.message.chat_id, context)
    return COMMENT


async def ask_comment(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    await send(
        context,
        chat_id,
        text=(
            "Бажаєте залишити *коментар* до резервації?\n\n"
            "_(наприклад: алергія, побажання щодо столика, привід тощо)_\n\n"
            "Або натисніть кнопку нижче, щоб пропустити."
        ),
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [["Без коментаря"]],
            one_time_keyboard=True,
            resize_keyboard=True,
        ),
    )


async def get_comment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    context.user_data["comment"] = None if text == "Без коментаря" else text
    await update.message.reply_text(
        f"*Перевірте вашу резервацію:*\n\n{summary(context.user_data)}\nВсе вірно, або бажаєте щось змінити?",
        parse_mode="Markdown",
        reply_markup=confirm_keyboard(),
    )
    return CONFIRM

# ---------------------------------------------------------------------------
# Confirm / edit callback
# ---------------------------------------------------------------------------

async def confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "confirm_yes":
        save_reservation(context.user_data)
        await query.edit_message_text(
            f"*Резервацію підтверджено!*\n\n{summary(context.user_data)}\n"
            "З нетерпінням очікуємо на вас!\n\n"
            "Щоб скасувати резервацію — /remove",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    # Edit branch — remove inline buttons first
    await query.edit_message_reply_markup(reply_markup=None)
    chat_id = query.message.chat_id

    if query.data == "edit_name":
        await send(context, chat_id, text="Введіть нове *ім'я*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardRemove())
        return NAME

    if query.data == "edit_guests":
        await send(context, chat_id, text="Оберіть нову *кількість гостей*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [["1", "2", "3", "4"], ["5", "6", "7", "8+"]],
                       one_time_keyboard=True, resize_keyboard=True,
                   ))
        return GUESTS

    if query.data == "edit_date":
        await send(context, chat_id, text="Оберіть нову *дату*:", parse_mode="Markdown",
                   reply_markup=date_keyboard())
        return DATE

    if query.data == "edit_time":
        await send(context, chat_id, text="Оберіть новий *час*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [
                           ["12:00", "13:00", "14:00"],
                           ["15:00", "16:00", "17:00"],
                           ["18:00", "19:00", "20:00"],
                           ["21:00", "22:00"],
                       ],
                       one_time_keyboard=True, resize_keyboard=True,
                   ))
        return TIME

    if query.data == "edit_preorder":
        await send(context, chat_id,
                   text="Оновіть ваше *передзамовлення* або пропустіть:",
                   parse_mode="Markdown",
                   reply_markup=preorder_keyboard())
        return PREORDER

    if query.data == "edit_comment":
        await send(context, chat_id,
                   text="Введіть новий *коментар*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [["Без коментаря"]], one_time_keyboard=True, resize_keyboard=True,
                   ))
        return COMMENT

    return CONFIRM

# ---------------------------------------------------------------------------
# /remove command
# ---------------------------------------------------------------------------

async def remove(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text(
        "Вашу резервацію скасовано.\n\nЩоб зробити нову — /start",
        reply_markup=ReplyKeyboardRemove(),
    )
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text(
        "Скасовано. Щоб почати знову — /start",
        reply_markup=ReplyKeyboardRemove(),
    )
    return ConversationHandler.END

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    app = Application.builder().token(TOKEN).build()

    conv = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            NAME:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
            GUESTS:   [MessageHandler(filters.TEXT & ~filters.COMMAND, get_guests)],
            DATE:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_date)],
            TIME:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_time)],
            PREORDER: [
                # WebApp closes → Telegram delivers web_app_data message
                MessageHandler(filters.StatusUpdate.WEB_APP_DATA, preorder_webapp_data),
                CallbackQueryHandler(preorder_skip, pattern="^skip_preorder$"),
            ],
            COMMENT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, get_comment)],
            CONFIRM:  [CallbackQueryHandler(confirm_callback)],
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("remove", remove),
        ],
    )

    app.add_handler(conv)
    app.add_handler(CommandHandler("remove", remove))

    logger.info("Bot starting…")
    app.run_polling()


if __name__ == "__main__":
    main()