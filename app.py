from flask import Flask, render_template
import os

app = Flask(__name__)

@app.route("/")
def index():
    return "Dom Jamon Bot"

@app.route("/preorder")
def preorder():
    return render_template("preorder.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)