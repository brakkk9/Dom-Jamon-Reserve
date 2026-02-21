import logging, json
from datetime import datetime, timedelta
from telegram import Update, ReplyKeyboardMarkup, ReplyKeyboardRemove, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import (
    Application, CommandHandler, MessageHandler, ConversationHandler,
    CallbackQueryHandler, filters, ContextTypes,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NAME, GUESTS, DATE, TIME, PREORDER, COMMENT, CONFIRM = range(7)

# ── URL of your hosted HTML page ──────────────────────────────────────────────
PREORDER_WEBAPP_URL = "https://your-hosted-page.com/preorder.html"  # ← change this

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def build_date_keyboard():
    today = datetime.today()
    buttons, row = [], []
    start = 0 if today.hour < 21 else 1
    for i in range(start, start + 7):
        day = today + timedelta(days=i)
        label = day.strftime("%d.%m") + (" (сьогодні)" if i == 0 else "")
        row.append(label)
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return ReplyKeyboardMarkup(buttons, one_time_keyboard=True, resize_keyboard=True)


def summary_text(data: dict) -> str:
    comment = data.get("comment") or "—"
    items = data.get("preorder_items")
    preorder_str = "\n  • " + "\n  • ".join(items) if items else "—"
    return (
        f"👤 Ім'я: {data.get('name')}\n"
        f"👥 Гості: {data.get('guests')}\n"
        f"📅 Дата: {data.get('date')}\n"
        f"🕐 Час: {data.get('time')}\n"
        f"🍽️ Передзамовлення:{preorder_str}\n"
        f"💬 Коментар: {comment}\n"
    )


def confirm_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Все вірно!", callback_data="confirm_yes")],
        [
            InlineKeyboardButton("✏️ Ім'я", callback_data="edit_name"),
            InlineKeyboardButton("✏️ Гості", callback_data="edit_guests"),
        ],
        [
            InlineKeyboardButton("✏️ Дата", callback_data="edit_date"),
            InlineKeyboardButton("✏️ Час", callback_data="edit_time"),
        ],
        [
            InlineKeyboardButton("✏️ Передзамовлення", callback_data="edit_preorder"),
            InlineKeyboardButton("✏️ Коментар", callback_data="edit_comment"),
        ],
    ])


def preorder_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(
            "🍽️ Обрати страви",
            web_app=WebAppInfo(url=PREORDER_WEBAPP_URL)
        )],
        [InlineKeyboardButton("➡️ Пропустити", callback_data="skip_preorder")],
    ])

# ─── FLOW HANDLERS ────────────────────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text(
        "👋 Вітаємо в *Dom Jamon*!\n\nЯ допоможу вам зарезервувати стіл. Почнімо!\n\nЯк вас *звати*?",
        parse_mode="Markdown", reply_markup=ReplyKeyboardRemove(),
    )
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["name"] = update.message.text.strip()
    await update.message.reply_text(
        f"Радий знайомству, *{context.user_data['name']}*! 🎉\n\nСкільки людей очікується?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup([["1","2","3","4"],["5","6","7","8+"]], one_time_keyboard=True, resize_keyboard=True),
    )
    return GUESTS

async def get_guests(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["guests"] = update.message.text.strip()
    await update.message.reply_text("Оберіть *дату* резервації:", parse_mode="Markdown", reply_markup=build_date_keyboard())
    return DATE

async def get_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["date"] = update.message.text.strip()
    await update.message.reply_text(
        "Тепер оберіть *час*:", parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup([
            ["12:00","13:00","14:00"], ["15:00","16:00","17:00"],
            ["18:00","19:00","20:00"], ["21:00","22:00"],
        ], one_time_keyboard=True, resize_keyboard=True),
    )
    return TIME

async def get_time(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["time"] = update.message.text.strip()
    await update.message.reply_text(
        "Бажаєте *передзамовити страви* заздалегідь? 🍽️\n\n"
        "Натисніть *Обрати страви* щоб переглянути меню, або пропустіть цей крок.",
        parse_mode="Markdown",
        reply_markup=preorder_keyboard(),
    )
    return PREORDER

async def preorder_skip(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["preorder_items"] = None
    await query.edit_message_reply_markup(reply_markup=None)
    await ask_comment(query.message.chat_id, context)
    return COMMENT

async def preorder_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receives data sent back from the WebApp via sendData()"""
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

async def ask_comment(chat_id, context):
    await context.bot.send_message(
        chat_id=chat_id,
        text="Бажаєте залишити *коментар* до резервації?\n\n"
             "_(наприклад: алергія, побажання щодо столика, привід тощо)_\n\n"
             "Або натисніть кнопку нижче, щоб пропустити.",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup([["Без коментаря"]], one_time_keyboard=True, resize_keyboard=True),
    )

async def get_comment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    context.user_data["comment"] = None if text == "Без коментаря" else text
    await update.message.reply_text(
        f"📋 *Перевірте вашу резервацію:*\n\n{summary_text(context.user_data)}\nВсе вірно, або бажаєте щось змінити?",
        parse_mode="Markdown", reply_markup=confirm_keyboard(),
    )
    return CONFIRM

# ─── CONFIRM / EDIT ───────────────────────────────────────────────────────────

async def confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "confirm_yes":
        await query.edit_message_text(
            f"✅ *Резервацію підтверджено!*\n\n{summary_text(context.user_data)}\n"
            "З нетерпінням очікуємо на вас! 🍽️\n\n"
            "Щоб скасувати резервацію, скористайтесь командою /remove",
            parse_mode="Markdown",
        )
        logger.info(f"New reservation: {context.user_data}")
        return ConversationHandler.END

    await query.edit_message_reply_markup(reply_markup=None)

    actions = {
        "edit_name":     (NAME,    "Введіть нове *ім'я*:", None),
        "edit_guests":   (GUESTS,  "Оберіть нову *кількість гостей*:", ReplyKeyboardMarkup([["1","2","3","4"],["5","6","7","8+"]], one_time_keyboard=True, resize_keyboard=True)),
        "edit_date":     (DATE,    "Оберіть нову *дату*:", build_date_keyboard()),
        "edit_time":     (TIME,    "Оберіть новий *час*:", ReplyKeyboardMarkup([["12:00","13:00","14:00"],["15:00","16:00","17:00"],["18:00","19:00","20:00"],["21:00","22:00"]], one_time_keyboard=True, resize_keyboard=True)),
        "edit_comment":  (COMMENT, "Введіть новий *коментар*:", ReplyKeyboardMarkup([["Без коментаря"]], one_time_keyboard=True, resize_keyboard=True)),
    }

    if data == "edit_preorder":
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="Оновіть ваше *передзамовлення* або пропустіть:",
            parse_mode="Markdown",
            reply_markup=preorder_keyboard(),
        )
        return PREORDER

    if data in actions:
        state, prompt, markup = actions[data]
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=prompt,
            parse_mode="Markdown",
            reply_markup=markup or ReplyKeyboardRemove(),
        )
        return state

    return CONFIRM


async def show_confirm(chat_id, context):
    await context.bot.send_message(
        chat_id=chat_id,
        text=f"📋 *Перевірте вашу резервацію:*\n\n{summary_text(context.user_data)}\nВсе вірно?",
        parse_mode="Markdown",
        reply_markup=confirm_keyboard(),
    )

async def edited_name(update, context):
    context.user_data["name"] = update.message.text.strip()
    await show_confirm(update.message.chat_id, context)
    return CONFIRM

async def edited_guests(update, context):
    context.user_data["guests"] = update.message.text.strip()
    await show_confirm(update.message.chat_id, context)
    return CONFIRM

async def edited_date(update, context):
    context.user_data["date"] = update.message.text.strip()
    await show_confirm(update.message.chat_id, context)
    return CONFIRM

async def edited_time(update, context):
    context.user_data["time"] = update.message.text.strip()
    await show_confirm(update.message.chat_id, context)
    return CONFIRM

async def edited_comment(update, context):
    text = update.message.text.strip()
    context.user_data["comment"] = None if text == "Без коментаря" else text
    await show_confirm(update.message.chat_id, context)
    return CONFIRM

# ─── REMOVE ───────────────────────────────────────────────────────────────────

async def remove(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get("name"):
        await update.message.reply_text("❌ У вас немає активної резервації.", reply_markup=ReplyKeyboardRemove())
        return
    context.user_data.clear()
    await update.message.reply_text("🗑️ Вашу резервацію було скасовано.\n\nЩоб зробити нову — напишіть /start", reply_markup=ReplyKeyboardRemove())

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Резервацію скасовано. Напишіть /start щоб почати знову.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    TOKEN = "8502174576:AAEYcRBjYvGkvd61cXolURx2XlRsmtd9pTg"
    app = Application.builder().token(TOKEN).build()

    conv_handler = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            NAME:    [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
            GUESTS:  [MessageHandler(filters.TEXT & ~filters.COMMAND, get_guests)],
            DATE:    [MessageHandler(filters.TEXT & ~filters.COMMAND, get_date)],
            TIME:    [MessageHandler(filters.TEXT & ~filters.COMMAND, get_time)],
            PREORDER: [
                CallbackQueryHandler(preorder_skip, pattern="^skip_preorder$"),
                MessageHandler(filters.StatusUpdate.WEB_APP_DATA, preorder_webapp_data),
            ],
            COMMENT: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_comment)],
            CONFIRM: [
                CallbackQueryHandler(confirm_callback),
                MessageHandler(filters.StatusUpdate.WEB_APP_DATA, preorder_webapp_data),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.Regex(r"^\d{2}\.\d{2}"), edited_date),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.Regex(r"^\d{2}:\d{2}$"), edited_time),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.Regex(r"^\d[\d+]?$|^8\+$"), edited_guests),
                MessageHandler(filters.TEXT & ~filters.COMMAND & filters.Regex(r"^Без коментаря$"), edited_comment),
                MessageHandler(filters.TEXT & ~filters.COMMAND, edited_name),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(conv_handler)
    app.add_handler(CommandHandler("remove", remove))
    app.run_polling()

if __name__ == "__main__":
    main()