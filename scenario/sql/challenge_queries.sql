-- SQL Interview Challenge Queries
-- Complete the following queries using the provided database

-- Challenge 1: Basic Queries
-- TODO: Write a query to find all customers from 'New York'

-- TODO: Write a query to find the total number of orders placed in 2023

-- TODO: Write a query to find the average order value

-- Challenge 2: Joins and Aggregations
-- TODO: Write a query to find the top 5 customers by total revenue

-- TODO: Write a query to find all products that have never been ordered

-- TODO: Write a query to find the monthly sales trend for the current year

-- Challenge 3: Advanced Queries
-- TODO: Write a query to find customers who have placed orders in consecutive months

-- TODO: Write a query to calculate the running total of sales by date

-- TODO: Write a query to find the second highest order value for each customer

-- Challenge 4: Window Functions
-- TODO: Rank customers by their order frequency within each city

-- TODO: Calculate the percentage of total sales each product contributes

-- Challenge 5: Complex Business Logic
-- TODO: Find customers who have spent more than the average customer in their city

-- TODO: Identify products that are performing below average in their category

-- TODO: Write a query to detect potentially fraudulent orders
-- (multiple orders from same customer in short time period with high values)

-- Performance Challenge
-- TODO: Optimize this slow query:
-- SELECT c.customer_name, COUNT(o.order_id) as order_count
-- FROM customers c
-- LEFT JOIN orders o ON c.customer_id = o.customer_id
-- WHERE c.city = 'Los Angeles'
-- GROUP BY c.customer_id, c.customer_name
-- HAVING COUNT(o.order_id) > 5;