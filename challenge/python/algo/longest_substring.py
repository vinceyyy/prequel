"""
Given a string `s`, find the the longest substring without duplicate characters.

Example 1:
    Input: s = "abcabcbb"
    Output: "abc"
    Explanation: The answer is "abc". Note that "bca" and "cab" are also correct answers.

Example 2:
    Input: s = "bbbbb"
    Output: "b"

Example 3:
    Input: s = "pwwkew"
    Output: "wke"

Notice that the answer must be a substring, "pwke" is a subsequence and not a substring.
"""


def longest_substring(s: str) -> str:
    pass


if __name__ == "__main__":
    print("Input #1: s = 'abcabcbb'")
    result_1 = longest_substring(s="abcabcbb")
    print("Result #1: ", result_1)
    assert result_1 in ("abc", "bca", "cab")

    print("Input #2: s = 'bbbbb'")
    result_2 = longest_substring(s="bbbbb")
    print("Result #2: ", result_2)
    assert result_2 == "b"

    print("Input #3: s = 'pwwkew'")
    result_3 = longest_substring(s="pwwkew")
    print("Result #3: ", result_3)
    assert result_3 == "wke"
