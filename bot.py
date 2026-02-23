"""
Dom Jamon — Reservation Bot
"""

import json
import logging
import os
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
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

TOKEN               = os.environ.get("BOT_TOKEN", "8502174576:AAEYcRBjYvGkvd61cXolURx2XlRsmtd9pTg")
PREORDER_WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://dom-jamon-reserve.vercel.app")
PREORDERS_FILE      = Path("preorders.json") 

logging.basicConfig(
    format="%(asctime)s  %(levelname)s  %(name)s — %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------

NAME, PHONE, GUESTS, DATE, TIME, PREORDER, COMMENT, CONFIRM = range(8)

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def save_reservation(data: dict) -> None:
    record = {
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "name":     data.get("name"),
        "phone":    data.get("phone"),
        "guests":   data.get("guests"),
        "date":     data.get("date"),
        "time":     data.get("time"),
        "preorder": data.get("preorder_items"),
        "comment":  data.get("comment"),
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
# Keyboards
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


def preorder_keyboard(existing_items: list | None = None) -> ReplyKeyboardMarkup:
    # Must be ReplyKeyboardMarkup + KeyboardButton — NOT InlineKeyboardMarkup.
    # tg.sendData() only works when the WebApp is opened via a KeyboardButton.
    url = PREORDER_WEBAPP_URL
    if existing_items:
        url += "?cart=" + urllib.parse.quote(json.dumps(existing_items))
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("Передзамовити страви", web_app=WebAppInfo(url=url))],
            ["Пропустити"],
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅  Все вірно!", callback_data="confirm_yes")],
        [
            InlineKeyboardButton("✏️  Ім'я",    callback_data="edit_name"),
            InlineKeyboardButton("📱  Телефон", callback_data="edit_phone"),
        ],
        [
            InlineKeyboardButton("👥  Гості",   callback_data="edit_guests"),
            InlineKeyboardButton("📅  Дата",    callback_data="edit_date"),
        ],
        [
            InlineKeyboardButton("🕐  Час",     callback_data="edit_time"),
            InlineKeyboardButton("🍽  Страви",  callback_data="edit_preorder"),
        ],
        [
            InlineKeyboardButton("💬  Коментар", callback_data="edit_comment"),
        ],
    ])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def summary(data: dict) -> str:
    lines = []
    lines.append(f"👤  Ім'я: {data.get('name')}")
    if data.get("phone"):
        lines.append(f"📱  Телефон: {data.get('phone')}")
    lines.append(f"👥  Гості: {data.get('guests')}")
    lines.append(f"📅  Дата: {data.get('date')}")
    lines.append(f"🕐  Час: {data.get('time')}")

    items = data.get("preorder_items")
    if items:
        item_lines = "\n".join(
            f"`  • {i['name']}"
            + (f" ({i['option']})" if i.get("option") else "")
            + f"  ×{i['qty']}  —  {i['price'] * i['qty']} ₴`"
            for i in items
        )
        total = sum(i["price"] * i["qty"] for i in items)
        lines.append(f"🍽  Передзамовлення:\n{item_lines}\n`  Разом: {total} ₴`")

    if data.get("comment"):
        lines.append(f"💬  Коментар: {data.get('comment')}")

    return "\n".join(lines)


async def send(context, chat_id: int, **kwargs) -> None:
    await context.bot.send_message(chat_id=chat_id, **kwargs)


async def show_confirm(context, chat_id: int) -> None:
    await send(
        context, chat_id,
        text=f"📋  *Перевірте вашу резервацію:*\n\n{summary(context.user_data)}\n\nВсе вірно, або бажаєте щось змінити?",
        parse_mode="Markdown",
        reply_markup=confirm_keyboard(),
    )


async def show_edit_menu(context, chat_id: int) -> None:
    """Used by /edit — shows only the edit buttons, no full summary."""
    await send(
        context, chat_id,
        text="✏️  Що бажаєте змінити?",
        parse_mode="Markdown",
        reply_markup=confirm_keyboard(),
    )

# ---------------------------------------------------------------------------
# Conversation handlers
# ---------------------------------------------------------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if context.user_data.get("name"):
        await update.message.reply_text(
            f"ℹ️  У вас вже є активна резервація:\n\n{summary(context.user_data)}\n\n"
            "Редагувати — /edit\n"
            "Скасувати і почати заново — /remove",
            parse_mode="Markdown",
            reply_markup=ReplyKeyboardRemove(),
        )
        return ConversationHandler.END
    context.user_data.clear()
    await update.message.reply_text(
        "👋  Вітаємо в *Dom Jamon*!\n\nЯ допоможу вам зарезервувати стіл. Почнімо!\n\nЯк вас *звати*?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardRemove(),
    )
    return NAME


async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["name"] = update.message.text.strip()
    if context.user_data.pop("_edit_field", None) == "name":
        await show_confirm(context, update.effective_chat.id)
        return CONFIRM
    await update.message.reply_text(
        f"Радий знайомству, *{context.user_data['name']}*! 🎉\n\nВкажіть ваш *номер телефону*:",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [[KeyboardButton("📱  Поділитися номером", request_contact=True)]],
            one_time_keyboard=True, resize_keyboard=True,
        ),
    )
    return PHONE


async def get_phone(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if update.message.contact:
        context.user_data["phone"] = update.message.contact.phone_number
    else:
        context.user_data["phone"] = update.message.text.strip()

    if context.user_data.pop("_edit_field", None) == "phone":
        await show_confirm(context, update.effective_chat.id)
        return CONFIRM

    await update.message.reply_text(
        "Скільки людей очікується? 👥",
        reply_markup=ReplyKeyboardMarkup(
            [["1", "2", "3", "4"], ["5", "6", "7", "8+"]],
            one_time_keyboard=True, resize_keyboard=True,
        ),
    )
    return GUESTS


async def get_guests(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["guests"] = update.message.text.strip()
    if context.user_data.pop("_edit_field", None) == "guests":
        await show_confirm(context, update.effective_chat.id)
        return CONFIRM
    await update.message.reply_text(
        "Оберіть *дату* резервації: 📅",
        parse_mode="Markdown",
        reply_markup=date_keyboard(),
    )
    return DATE


async def get_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["date"] = update.message.text.strip()
    if context.user_data.pop("_edit_field", None) == "date":
        await show_confirm(context, update.effective_chat.id)
        return CONFIRM
    await update.message.reply_text(
        "Тепер оберіть *час*: 🕐",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [
                ["12:00", "13:00", "14:00"],
                ["15:00", "16:00", "17:00"],
                ["18:00", "19:00", "20:00"],
                ["21:00", "22:00"],
            ],
            one_time_keyboard=True, resize_keyboard=True,
        ),
    )
    return TIME


async def get_time(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["time"] = update.message.text.strip()
    if context.user_data.pop("_edit_field", None) == "time":
        await show_confirm(context, update.effective_chat.id)
        return CONFIRM
    await update.message.reply_text(
        "Бажаєте *передзамовити страви* заздалегідь? 🍽\n\n"
        "Натисніть кнопку нижче щоб відкрити меню, або пропустіть цей крок.",
        parse_mode="Markdown",
        reply_markup=preorder_keyboard(),
    )
    return PREORDER


async def preorder_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Called when the WebApp closes via tg.sendData()."""
    # Read data first, then try to delete the service message
    raw = update.effective_message.web_app_data.data
    try:
        await update.effective_message.delete()
    except Exception:
        pass
    try:
        payload = json.loads(raw)
        if payload.get("action") == "preorder" and payload.get("items"):
            context.user_data["preorder_items"] = payload["items"]
        elif payload.get("action") == "preorder" and not payload.get("items"):
            context.user_data["preorder_items"] = None
        elif payload.get("action") == "skip":
            if not context.user_data.get("_editing"):
                context.user_data["preorder_items"] = None
    except Exception:
        context.user_data["preorder_items"] = None

    return await after_preorder(update.effective_message.chat_id, context)


async def preorder_skip(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not context.user_data.get("_editing"):
        context.user_data["preorder_items"] = None
    return await after_preorder(update.effective_message.chat_id, context)


async def after_preorder(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> int:
    """After preorder: go back to confirm if editing, else proceed to comment."""
    editing = context.user_data.pop("_editing", False)



    if editing:
        # Must explicitly dismiss the reply keyboard before showing inline keyboard.
        # We keep this message visible (not deleted) so Telegram actually processes it.
        await context.bot.send_message(
            chat_id=chat_id,
            text="✅  Передзамовлення оновлено.",
            reply_markup=ReplyKeyboardRemove(),
        )
        await show_confirm(context, chat_id)
        return CONFIRM
    else:
        if context.user_data.get("preorder_items"):
            await context.bot.send_message(
                chat_id=chat_id,
                text="✅  Передзамовлення прийнято.",
                reply_markup=ReplyKeyboardRemove(),
            )
        await ask_comment(chat_id, context)
        return COMMENT


async def ask_comment(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    await send(
        context, chat_id,
        text=(
            "💬  Бажаєте залишити *коментар* до резервації?\n\n"
            "_(наприклад: алергія, побажання щодо столика, привід тощо)_\n\n"
            "Або натисніть кнопку нижче, щоб пропустити."
        ),
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [["Без коментаря"]], one_time_keyboard=True, resize_keyboard=True,
        ),
    )


async def get_comment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    context.user_data["comment"] = None if text == "Без коментаря" else text

    await show_confirm(context, update.effective_chat.id)
    return CONFIRM

# ---------------------------------------------------------------------------
# Confirm / edit
# ---------------------------------------------------------------------------

async def confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "confirm_yes":
        save_reservation(context.user_data)
        await query.edit_message_text(
            f"✅  *Резервацію підтверджено!*\n\n{summary(context.user_data)}\n\n"
            "З нетерпінням очікуємо на вас! 🥂\n\n"
            "Редагувати — /edit\n"
            "Скасувати — /remove",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    await query.edit_message_reply_markup(reply_markup=None)
    chat_id = query.message.chat_id

    if query.data == "edit_name":
        context.user_data["_edit_field"] = "name"
        await send(context, chat_id, text="✏️  Введіть нове *ім'я*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardRemove())
        return NAME

    if query.data == "edit_phone":
        context.user_data["_edit_field"] = "phone"
        await send(context, chat_id, text="📱  Введіть новий *номер телефону*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [[KeyboardButton("📱  Поділитися номером", request_contact=True)]],
                       one_time_keyboard=True, resize_keyboard=True,
                   ))
        return PHONE

    if query.data == "edit_guests":
        context.user_data["_edit_field"] = "guests"
        await send(context, chat_id, text="👥  Оберіть нову *кількість гостей*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [["1", "2", "3", "4"], ["5", "6", "7", "8+"]],
                       one_time_keyboard=True, resize_keyboard=True,
                   ))
        return GUESTS

    if query.data == "edit_date":
        context.user_data["_edit_field"] = "date"
        await send(context, chat_id, text="📅  Оберіть нову *дату*:", parse_mode="Markdown",
                   reply_markup=date_keyboard())
        return DATE

    if query.data == "edit_time":
        context.user_data["_edit_field"] = "time"
        await send(context, chat_id, text="🕐  Оберіть новий *час*:", parse_mode="Markdown",
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
        context.user_data["_editing"] = True
        existing = context.user_data.get("preorder_items")
        await send(context, chat_id,
                   text="🍽  Оновіть ваше *передзамовлення* або пропустіть:",
                   parse_mode="Markdown",
                   reply_markup=preorder_keyboard(existing))
        return PREORDER

    if query.data == "edit_comment":
        await send(context, chat_id, text="💬  Введіть новий *коментар*:", parse_mode="Markdown",
                   reply_markup=ReplyKeyboardMarkup(
                       [["Без коментаря"]], one_time_keyboard=True, resize_keyboard=True,
                   ))
        return COMMENT

    return CONFIRM

# ---------------------------------------------------------------------------
# /edit — re-open confirm screen for existing reservation
# ---------------------------------------------------------------------------

async def edit_reservation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not context.user_data.get("name"):
        await update.message.reply_text(
            "У вас немає активної резервації.\n\nЩоб зробити нову — /start",
        )
        return ConversationHandler.END
    await show_edit_menu(context, update.effective_chat.id)
    return CONFIRM

# ---------------------------------------------------------------------------
# /remove — cancel reservation
# ---------------------------------------------------------------------------

async def remove(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not context.user_data.get("name"):
        await update.message.reply_text("У вас немає активної резервації.")
        return ConversationHandler.END
    await update.message.reply_text(
        "🗑  Ви впевнені, що хочете скасувати резервацію?",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅  Так, скасувати", callback_data="remove_yes"),
                InlineKeyboardButton("❌  Ні", callback_data="remove_no"),
            ]
        ]),
    )
    return ConversationHandler.END  # handled by remove_callback below


async def remove_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    if query.data == "remove_yes":
        context.user_data.clear()
        await query.edit_message_text("🗑  Резервацію скасовано.\n\nЩоб зробити нову — /start")
    else:
        await query.edit_message_text("👍  Резервацію збережено.")


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

    # Shared states used by both conversation handlers
    shared_states = {
        NAME:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
        PHONE:    [
            MessageHandler(filters.CONTACT, get_phone),
            MessageHandler(filters.TEXT & ~filters.COMMAND, get_phone),
        ],
        GUESTS:   [MessageHandler(filters.TEXT & ~filters.COMMAND, get_guests)],
        DATE:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_date)],
        TIME:     [MessageHandler(filters.TEXT & ~filters.COMMAND, get_time)],
        PREORDER: [
            MessageHandler(filters.StatusUpdate.WEB_APP_DATA, preorder_webapp_data),
            MessageHandler(filters.Regex(r"^Пропустити$"), preorder_skip),
        ],
        COMMENT:  [MessageHandler(filters.TEXT & ~filters.COMMAND, get_comment)],
        CONFIRM:  [CallbackQueryHandler(confirm_callback)],
    }

    shared_fallbacks = [
        CommandHandler("start",  start),
        CommandHandler("cancel", cancel),
        CommandHandler("remove", remove),
    ]

    # Primary flow: /start -> full booking
    booking_conv = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states=shared_states,
        fallbacks=shared_fallbacks,
    )

    # Edit/remove flow: works independently after booking is complete
    edit_conv = ConversationHandler(
        entry_points=[
            CommandHandler("edit",   edit_reservation),
            CommandHandler("remove", remove),
        ],
        states=shared_states,
        fallbacks=shared_fallbacks,
    )

    app.add_handler(booking_conv)
    app.add_handler(edit_conv)
    app.add_handler(CallbackQueryHandler(remove_callback, pattern="^remove_(yes|no)$"))

    logger.info("Bot starting...")
    app.run_polling()


    

if __name__ == "__main__":
    main()