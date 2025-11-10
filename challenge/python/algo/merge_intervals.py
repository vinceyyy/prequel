"""
Given an array of intervals, merge all overlapping intervals, and return an array of the non-overlapping intervals that
cover all the intervals in the input.


Example 1:
    Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
    Output: [[1,6],[8,10],[15,18]]
    Explanation: Since intervals [1,3] and [2,6] overlap, merge them into [1,6].

Example 2:
    Input: intervals = [[1,4],[4,5]]
    Output: [[1,5]]
    Explanation: Intervals [1,4] and [4,5] are considered overlapping.

Example 3:
    Input: intervals = [[4,7],[1,4]]
    Output: [[1,7]]
    Explanation: Intervals [1,4] and [4,7] are considered overlapping.


Constraints:
    1: 1 <= intervals.length <= 104
    2: intervals[i].length == 2
    3: 0 <= start <= end <= 104

"""


def merge_intervals(intervals: list[list[int]]) -> list[list[int]]:
    pass


if __name__ == "__main__":
    print("Input #1: intervals = [[1,3],[2,6],[8,10],[15,18]]")
    result_1 = merge_intervals([[1, 3], [2, 6], [8, 10], [15, 18]])
    print("Result #1: ", result_1)
    assert result_1 == [[1, 6], [8, 10], [15, 18]]

    print("Input #2: intervals = [[1,4],[4,5]]")
    result_2 = merge_intervals([[1, 4], [4, 5]])
    print("Result #2: ", result_2)
    assert result_2 == [[1, 4], [4, 5]]

    print("Input #3: intervals = [[2,6],[8,10],[15,18]]")
    result_3 = merge_intervals([[2, 6], [8, 10], [15, 18]])
    print("Result #3: ", result_3)
    assert result_3 == [[2, 6], [8, 10], [15, 18]]
