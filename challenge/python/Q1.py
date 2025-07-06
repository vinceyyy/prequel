"""
Given an array and a sum value, find all possible unique triplets in that array whose sum is equal to the given sum
value. If no such triplets can be formed from the array, then print “No triplets can be formed.”, else print all the
unique triplets.
For example, if the given array is {12, 3, 6, 1, 6, 9} and the given sum is 24, then the unique triplets are (3, 9, 12)
and (6, 6, 12) whose sum is 24.

Examples:
Input: array = {12, 3, 6, 1, 6, 9} sum = 24
Output: [[3, 9, 12], [6, 6, 12]]

Input: array = {-2, 0, 1, 1, 2} sum = 0
Output: [[-2, 0, 2], [-2, 1, 1]]

Input: array = {-2, 0, 1, 1, 2} sum = 10
Output: No triplets can be formed.
"""


def find_triplets(array: list, sum: int) -> list:
    pass


if __name__ == "__main__":
    print("Input #1: array = {12, 3, 6, 1, 6, 9}  sum = 24")
    result_1 = find_triplets(array=[12, 3, 6, 1, 6, 9], sum=24)
    assert result_1 == [[3, 9, 12], [6, 6, 12]]
    print("Output #1: ", result_1)

    print("Input #2: array = {-2, 0, 1, 1, 2} sum = 0")
    result_2 = find_triplets(array=[-2, 0, 1, 1, 2], sum=0)
    assert result_2 == [[-2, 0, 2], [-2, 1, 1]]
    print("Output #2: ", result_2)

    print("Input #3: array = {-2, 0, 1, 1, 2} sum = 10")
    result_3 = find_triplets(array=[-2, 0, 1, 1, 2], sum=10)
    assert result_3 == "No triplets can be formed."
    print("Output #3: ", result_3)
