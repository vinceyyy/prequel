"""
Data Analysis Challenge

You have been given a dataset of customer sales data.
Complete the following tasks:

1. Load and explore the dataset
2. Clean the data (handle missing values, duplicates)
3. Calculate key metrics
4. Create visualizations
5. Answer business questions
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

# TODO: Load the sales_data.csv file
def load_data():
    """Load the sales dataset"""
    pass

# TODO: Explore the dataset structure
def explore_data(df):
    """Print basic information about the dataset"""
    pass

# TODO: Clean the data
def clean_data(df):
    """Handle missing values and duplicates"""
    pass

# TODO: Calculate key business metrics
def calculate_metrics(df):
    """
    Calculate:
    - Total sales by month
    - Average order value
    - Top 10 customers by revenue
    - Product performance
    """
    pass

# TODO: Create visualizations
def create_visualizations(df):
    """
    Create:
    - Sales trend over time
    - Top products bar chart
    - Customer segmentation
    """
    pass

# TODO: Answer business questions
def answer_questions(df):
    """
    Answer:
    1. What is the seasonal trend in sales?
    2. Which product category generates the most revenue?
    3. What is the customer retention rate?
    4. Which regions have the highest sales growth?
    """
    pass

if __name__ == "__main__":
    # Main execution flow
    print("Starting data analysis challenge...")
    
    # Load data
    df = load_data()
    
    # Explore data
    explore_data(df)
    
    # Clean data
    df_clean = clean_data(df)
    
    # Calculate metrics
    metrics = calculate_metrics(df_clean)
    
    # Create visualizations
    create_visualizations(df_clean)
    
    # Answer questions
    answer_questions(df_clean)