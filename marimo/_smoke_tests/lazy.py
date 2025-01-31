# Copyright 2024 Marimo. All rights reserved.

import marimo

__generated_with = "0.3.8"
app = marimo.App(width="full")


@app.cell
def __(generate_number, mo, table):
    tabs = mo.ui.tabs(
        {
            "First": "",
            "Second": mo.lazy(table),
            "Third": mo.lazy(generate_number, show_loading_indicator=True),
        }
    )
    tabs
    return tabs,


@app.cell
def __(generate_number, mo, table):
    auto_lazy_tabs = mo.ui.tabs(
        {
            "First": "",
            "Second": table,
            "Third": generate_number,
        },
        lazy=True,
    )
    auto_lazy_tabs
    return auto_lazy_tabs,


@app.cell
def __(generate_number, mo):
    mo.accordion({"Open me": mo.lazy(generate_number, show_loading_indicator=True)})
    return


@app.cell
def __(generate_number, mo):
    mo.accordion({"Open me": generate_number}, lazy=True)
    return


@app.cell
def __(random, time):
    def generate_number():
        print("Loading...")
        time.sleep(1)
        print("Loaded!")
        num = random.randint(0, 100)
        return num
    return generate_number,


@app.cell
def __():
    import marimo as mo
    import pandas as pd
    import random
    import time
    import vega_datasets

    cars = vega_datasets.data.cars()
    table = mo.ui.table(cars)
    return cars, mo, pd, random, table, time, vega_datasets


if __name__ == "__main__":
    app.run()
