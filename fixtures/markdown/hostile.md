# Hostile

<script>alert('xss')</script>

Click [bad](javascript:alert(1)) or <img src=x onerror=alert(1)> here.

<a href="javascript:alert(2)" onclick="alert(3)">raw html link</a>

Safe text remains.
